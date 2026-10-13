const test = require('node:test');
const assert = require('node:assert/strict');
const { installVscodeMock } = require('./helpers/vscode.cjs');
const fixture = installVscodeMock();
const { BaseReaderController } = require('../out/providers/baseReaderController');
const { ReaderViewProvider } = require('../out/providers/readerViewProvider');
const { ReaderPanelSerializer, ReaderProvider } = require('../out/providers/readerProvider');
const { BookshelfProvider, BookItem, ChapterItem } = require('../out/providers/bookshelfProvider');
const { CommentReaderController } = require('../out/stealth/commentReaderController');
const { PreloadManager } = require('../out/preload/preloadManager');
const config = { enabled: true, chapterCount: 2, triggerProgress: 50, maxCacheSize: 10 };
const chapters = [
  { index: 0, title: 'Volume one', isVolume: true },
  { index: 3, title: 'First readable' },
  { index: 7, title: 'Volume two', isVolume: true },
  { index: 10, title: 'Second readable' },
  { index: 15, title: 'Third readable' },
];
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function api(key) {
  return {
    stateKey: key, isActive: true, requests: [], saves: [],
    ownsBook(book) { return book.sourceKey === this.stateKey; },
    dispose() { this.isActive = false; },
    async getBookshelf() { return [book(key)]; },
    async getChapterList() { return chapters; },
    async getBookContent(url, index) { assert.equal(this.isActive, true); this.requests.push(index); return { title: `${key}-${index}`, content: `${key} content ${index}。` }; },
    async saveBookProgress(url, index) { assert.equal(this.isActive, true); this.saves.push(index); },
  };
}
function book(key) { return { sourceKey: key, bookUrl: 'same-id', name: key, author: 'author', durChapterIndex: 0 }; }
class Reader extends BaseReaderController {
  constructor(client) { super(fixture.context.extensionUri, client, undefined, config); this.webview = fixture.createWebview(); this._isWebviewReady = true; }
  getWebview() { return this.webview; }
  updateTitle() {}
  dispose() { this.resetReadingState(); this.preloadManager.dispose(); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('readers navigate volumes using server indices and save first open/cache reads only', async () => {
  const client = api('one'); const reader = new Reader(client);
  try {
    await reader.openBook(book('one'), 0);
    assert.equal(reader.currentChapterIndex, 3);
    assert.deepEqual(client.saves, [3]);
    reader._lastNavTime = 0; await reader.nextChapter();
    assert.equal(reader.currentChapterIndex, 10);
    reader._lastNavTime = 0; await reader.prevChapter();
    assert.equal(reader.currentChapterIndex, 3);
    assert.deepEqual(client.requests, [3, 10]);
    assert.deepEqual(client.saves, [3, 10, 3]);
    assert.equal(reader.webview.messages.filter(message => message.command === 'updateChapter').at(-1).data.hasPrev, false);
    client.getBookContent = async () => { throw new Error('failed'); };
    reader._lastNavTime = 0; await reader.nextChapter(); // already cached: still a successful read
    reader._lastNavTime = 0; await reader.nextChapter(); // uncached failure
    assert.deepEqual(client.saves, [3, 10, 3, 10]);
  } finally { reader.dispose(); }
});

test('delayed old chapter response cannot restore text or poison replacement cache', async () => {
  const old = api('old'), next = api('new'), pending = deferred();
  old.getBookContent = () => pending.promise;
  const reader = new Reader(old);
  try {
    const opening = reader.openBook(book('old'));
    await flush(); old.dispose(); reader.updateApiClient(next);
    assert.equal(reader.currentBook, undefined); assert.deepEqual(reader.chapters, []);
    reader._isWebviewReady = true;
    await reader.openBook(book('new'));
    pending.resolve({ title: 'OLD', content: 'OLD SECRET' }); await opening;
    assert.equal(reader.currentBook.sourceKey, 'new');
    assert.equal(reader.webview.messages.some(message => message.data?.content === 'OLD SECRET'), false);
    assert.equal((await reader.preloadManager.getChapterContent('same-id', 3)).content, 'new content 3。');
    assert.deepEqual(old.saves, []); assert.deepEqual(next.saves, [3]);
  } finally { reader.dispose(); }
});

test('old book operation and delayed quickpick cannot navigate replacement book', async () => {
  const client = api('one'), pending = deferred(), reader = new Reader(client);
  try {
    client.getChapterList = () => pending.promise;
    const opening = reader.openBook(book('one'));
    client.getChapterList = async () => chapters;
    await reader.openBook({ ...book('one'), bookUrl: 'second' }, 10);
    pending.resolve(chapters); await opening;
    assert.equal(reader.currentBook.bookUrl, 'second'); assert.equal(reader.currentChapterIndex, 10);
    const picked = deferred(); fixture.vscode.window.showQuickPick = () => picked.promise;
    const selecting = reader.selectChapter();
    await reader.openBook({ ...book('one'), bookUrl: 'third' }, 15);
    picked.resolve({ index: 3 }); await selecting;
    assert.equal(reader.currentChapterIndex, 15);
  } finally { fixture.vscode.window.showQuickPick = async () => undefined; reader.dispose(); }
});

test('preloading skips volumes without saving progress and discards old queued work', async () => {
  const old = api('old'), next = api('new'), pending = deferred();
  const manager = new PreloadManager(old, config);
  old.getBookContent = async (_url, index) => { old.requests.push(index); return pending.promise; };
  try {
    manager.setCurrentBook('same-id', chapters);
    manager.onReadingProgress({ chapterIndex: 3, progress: 60, totalChapters: chapters.length });
    await flush(); assert.deepEqual(old.requests, [10]);
    old.dispose(); manager.updateApiClient(next);
    pending.resolve({ title: 'old', content: 'old' }); await flush();
    assert.equal(manager.getStats().queueSize, 0); assert.equal(manager.getStats().cache.currentCacheSize, 0);
    assert.deepEqual(next.requests, []); assert.deepEqual(old.requests, [10]);
    manager.setCurrentBook('same-id', chapters);
    await manager.triggerPreload('same-id', 3);
    assert.deepEqual(next.requests, [10, 15]);
    assert.deepEqual(next.saves, []);
  } finally { manager.dispose(); }
});

test('bookshelf ignores old shelves and chapter cache responses; volumes are non-clickable', async () => {
  const old = api('old'), next = api('new'), shelfResponse = deferred(), chapterResponse = deferred();
  old.getBookshelf = () => shelfResponse.promise; old.getChapterList = () => chapterResponse.promise;
  next.getChapterList = async () => [{ index: 22, title: 'New backend chapter' }];
  const shelf = new BookshelfProvider(old);
  const loading = shelf.getChildren(new BookItem(book('old')));
  old.dispose(); shelf.updateApiClient(next); await flush();
  shelfResponse.resolve([book('old')]); chapterResponse.resolve(chapters); await loading;
  assert.equal(shelf.getBooks()[0].sourceKey, 'new');
  assert.deepEqual(await shelf.getChildren(new BookItem(book('old'))), []);
  assert.equal(new ChapterItem(book('new'), chapters[0], false).command, undefined);
  assert.deepEqual(await shelf.getChapterList('same-id'), [{ index: 22, title: 'New backend chapter' }]);
});

test('switch clears unresolved sidebar book and serializer rejects another source', async () => {
  const old = api('old'), next = api('new');
  const view = new ReaderViewProvider(fixture.context.extensionUri, old, undefined, config);
  await view.openBook(book('old')); old.dispose(); view.updateApiClient(next);
  assert.equal(view._pendingBook, undefined); view.dispose();
  const panel = fixture.createPanel();
  const serializer = new ReaderPanelSerializer(fixture.context.extensionUri, () => next, () => undefined, () => config);
  await serializer.deserializeWebviewPanel(panel, { book: book('old'), chapterIndex: 3 });
  assert.equal(ReaderProvider.currentPanel.currentBook, undefined);
  ReaderProvider.currentPanel.dispose();
});

test('comment history is source-scoped and switching discards delayed plaintext', async () => {
  const old = api('old'), next = api('new'), response = deferred();
  fixture.globalState.clear();
  fixture.globalState.set('readermate.commentReader.state', { book: book('old'), chapterIndex: 3, sentenceIndex: 1 });
  const preload = new PreloadManager(old, config);
  const comments = new CommentReaderController(fixture.context, old, { getBooks: () => [] }, preload);
  try {
    assert.equal(comments.currentBook, null);
    old.getBookContent = () => response.promise;
    const loading = comments.setBook(book('old'), 0); await flush();
    old.dispose(); comments.updateApiClient(next);
    await comments.setBook(book('new'), 7);
    assert.equal(comments.currentChapterIndex, 10);
    response.resolve({ title: 'OLD', content: 'SECRET。' }); await loading;
    assert.equal(comments.chapterContent.content, 'new content 10。');
    assert.deepEqual(old.saves, []); assert.deepEqual(next.saves, [10]);
    assert.equal(fixture.globalState.get(`readermate.commentReader.state.${next.stateKey}`).book.sourceKey, 'new');
    assert.equal(comments.isVisible, false);
    await comments.prevChapter(); assert.equal(comments.currentChapterIndex, 3);
  } finally { comments.dispose(); preload.dispose(); }
});

test('chapter pickers exclude volume rows and preserve server chapter indices', async () => {
  const client = api('one'); const reader = new Reader(client);
  const preload = new PreloadManager(client, config);
  const comments = new CommentReaderController(fixture.context, client, { getBooks: () => [] }, preload);
  fixture.vscode.window.showQuickPick = async items => {
    assert.deepEqual(items.map(item => item.index ?? item.chapterIndex), [3, 10, 15]);
    return items[1];
  };
  try {
    await reader.openBook(book('one')); await reader.selectChapter();
    assert.equal(reader.currentChapterIndex, 10);
    await comments.setBook(book('one')); await comments.selectChapterQuickPick();
    assert.equal(comments.currentChapterIndex, 10);
  } finally {
    fixture.vscode.window.showQuickPick = async () => undefined;
    reader.dispose(); comments.dispose();
  }
});

test('restored comments reject wrong-source history and skip restored volume indices', async () => {
  const client = api('one');
  const key = `readermate.commentReader.state.${client.stateKey}`;
  fixture.globalState.clear();
  fixture.globalState.set(key, { book: book('other'), chapterIndex: 7, sentenceIndex: 0 });
  const invalid = new CommentReaderController(fixture.context, client, { getBooks: () => [] }, new PreloadManager(client, config));
  assert.equal(invalid.currentBook, null); invalid.dispose();
  fixture.globalState.set(key, { book: book('one'), chapterIndex: 7, sentenceIndex: 0 });
  const restored = new CommentReaderController(fixture.context, client, { getBooks: () => [] }, new PreloadManager(client, config));
  try {
    await restored.ensureContentLoaded();
    assert.equal(restored.currentChapterIndex, 10);
    assert.deepEqual(client.requests, [10]); assert.deepEqual(client.saves, [10]);
  } finally { restored.dispose(); }
});

test('switch during automatic comment selection cannot load or reveal old shelf book', async () => {
  const old = api('old'), next = api('new'), shelf = deferred();
  old.getBookshelf = () => shelf.promise;
  fixture.globalState.clear();
  fixture.vscode.window.activeTextEditor = fixture.createEditor();
  const comments = new CommentReaderController(fixture.context, old, { getBooks: () => [] }, new PreloadManager(old, config));
  try {
    const showing = comments.show(); await flush();
    old.dispose(); comments.updateApiClient(next);
    shelf.resolve([book('old')]); await showing;
    assert.equal(comments.currentBook, null);
    assert.deepEqual(comments.sentences, []);
    assert.deepEqual(next.requests, []);
    assert.equal(comments.isVisible, false);
    assert.deepEqual(fixture.vscode.window.activeTextEditor.decorations, []);
  } finally { comments.dispose(); fixture.vscode.window.activeTextEditor = undefined; }
});

test('disposing preload cancels scheduled work and forbids cached or future reads', async () => {
  const client = api('one'), manager = new PreloadManager(client, config);
  manager.setCurrentBook('same-id', chapters);
  await manager.getChapterContent('same-id', 3);
  manager.dispose();
  await assert.rejects(manager.getChapterContent('same-id', 3), /阅读会话已结束/);
  manager.onReadingProgress({ chapterIndex: 3, progress: 80, totalChapters: chapters.length });
  await flush();
  assert.deepEqual(client.requests, [3]);
  assert.equal(manager.getStats().queueSize, 0);
});

test('switch immediately clears already displayed chapter, navigation and cached book', async () => {
  const old = api('old'), next = api('new'), reader = new Reader(old);
  try {
    await reader.openBook(book('old'), 10);
    assert.ok(reader._pendingChapterContent.content.includes('old'));
    old.dispose(); reader.updateApiClient(next);
    assert.equal(reader.currentBook, undefined);
    assert.equal(reader._pendingChapterContent, undefined);
    assert.equal(reader.preloadManager.currentBook, undefined);
    assert.equal(reader.preloadManager.getStats().cache.currentCacheSize, 0);
    assert.equal(reader._isNavigating, false);
    assert.equal(reader._lastNavTime, 0);
    assert.equal(reader.webview.html.includes('old content'), false);
  } finally { reader.dispose(); }
});

test('backend replacement cancels preload retry timers before they reach the new client', async () => {
  const old = api('old'), next = api('new'), manager = new PreloadManager(old, config);
  old.getBookContent = async (_url, index) => { old.requests.push(index); throw new Error('temporary failure'); };
  try {
    manager.setCurrentBook('same-id', chapters);
    const preloading = manager.triggerPreload('same-id', 3);
    await flush();
    old.dispose(); manager.updateApiClient(next);
    await preloading;
    await new Promise(resolve => setTimeout(resolve, 2100));
    assert.equal(manager.getStats().queueSize, 0);
    assert.deepEqual(old.requests, [10]); assert.deepEqual(next.requests, []);
  } finally { manager.dispose(); }
});
