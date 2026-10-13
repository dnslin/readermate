const assert = require('node:assert/strict');
const http = require('node:http');
const vscode = require('vscode');

async function waitFor(predicate, description) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${description}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

exports.run = async function run() {
  const requests = [];
  const chapters = [
    { index: 0, title: '第一卷', isVolume: true },
    { index: 1, title: '第一章', isVolume: false },
    { index: 2, title: '第二卷', isVolume: true },
    { index: 3, title: '第二章', isVolume: false },
  ];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), method: req.method, body: body ? JSON.parse(body) : undefined });
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname.startsWith('/reader3/')) {
        assert.equal(url.searchParams.get('accessToken'), 'smoke:token');
        const route = url.pathname.slice('/reader3/'.length);
        const data = route === 'getBookshelf' ? [{ name: 'Reader3 验证书籍', author: '测试作者', bookUrl: 'r3-book', durChapterIndex: 0 }]
          : route === 'getChapterList' ? [{ index: 0, title: 'Reader3 正文', url: 'chapter0' }]
          : route === 'getBookContent' ? 'Reader3 第一段。\nReader3 第二段。' : null;
        res.end(JSON.stringify({ isSuccess: true, data }));
      } else {
        assert.equal(req.headers['x-api-key'], 'lgd_smoke');
        const book = { id: 7, name: 'Legado 验证书籍', author: '测试作者', bookUrl: 'source-url', durChapterIndex: 0, totalChapterNum: 4 };
        if (url.pathname === '/openapi/v1/shelf') res.end(JSON.stringify([book]));
        else if (url.pathname === '/openapi/v1/books/7') res.end(JSON.stringify({ book, chapters }));
        else if (url.pathname === '/openapi/v1/books/7/content') {
          const index = Number(url.searchParams.get('index'));
          assert.equal(url.searchParams.get('saveProgress'), 'false');
          assert.ok(index === 1 || index === 3, 'volume must never be requested as content');
          res.end(JSON.stringify({ bookId: 7, index, title: chapters[index].title, content: `Legado 第${index}章验证正文。\n换行保持正常。` }));
        } else if (url.pathname === '/openapi/v1/books/7/progress') {
          assert.equal(req.method, 'PUT');
          assert.ok(JSON.parse(body).index === 1 || JSON.parse(body).index === 3);
          res.end(JSON.stringify({ ok: true }));
        } else { res.writeHead(404); res.end(JSON.stringify({ error: 'Unexpected route' })); }
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  const cfg = vscode.workspace.getConfiguration('readermate');
  const settings = {
    serverUrl: address, username: 'smoke', token: 'token', appendReader3Path: true,
    'legado.serverUrl': address, 'legado.apiKey': 'lgd_smoke', backend: 'reader3',
    'preload.enabled': false, 'stealth.enabled': false, 'chapterDisplay.location': 'sidebar',
  };
  try {
    for (const [key, value] of Object.entries(settings)) await cfg.update(key, value, vscode.ConfigurationTarget.Global);
    const extension = vscode.extensions.getExtension('readermate-dnslin.readermate');
    assert.ok(extension, 'development extension must be registered');
    await extension.activate();
    const { ReaderProvider } = require('../../out/providers/readerProvider.js');
    const view = ReaderProvider.currentViewProvider;
    assert.ok(view, 'actual extension must register sidebar reader');
    await waitFor(() => view.bookshelfProvider.getBooks()[0]?.name === 'Reader3 验证书籍', 'Reader3 shelf');
    const oldClient = view.apiClient;
    const oldBook = view.bookshelfProvider.getBooks()[0];
    await vscode.commands.executeCommand('readermate.openReader', oldBook);
    await waitFor(() => view._pendingChapterContent?.content.includes('Reader3 第二段'), 'Reader3 content');
    await cfg.update('backend', 'legado', vscode.ConfigurationTarget.Global);
    await waitFor(() => view.bookshelfProvider.getBooks()[0]?.name === 'Legado 验证书籍', 'Legado shelf');
    assert.equal(oldClient.isActive, false);
    assert.equal(view.currentBook, undefined);
    assert.equal(view._pendingChapterContent, undefined);
    const switchOffset = requests.length;
    await vscode.commands.executeCommand('readermate.openReader', oldBook);
    assert.equal(view.currentBook, undefined, 'old selection must be rejected');
    await vscode.commands.executeCommand('readermate.openReader', view.bookshelfProvider.getBooks()[0]);
    await waitFor(() => view._pendingChapterContent?.chapterIndex === 1, 'initial volume skipping');
    await vscode.commands.executeCommand('readermate.nextChapter');
    await waitFor(() => view._pendingChapterContent?.chapterIndex === 3, 'cross-volume next chapter');
    assert.ok(view._pendingChapterContent.content.includes('\n换行保持正常。'));
    assert.ok(requests.slice(switchOffset).every(request => request.path.startsWith('/openapi/v1/')));
    assert.ok(requests.some(request => request.path.endsWith('/progress') && request.body.index === 3));
    console.log(`ReaderMate extension-host smoke passed: Reader3 → Legado; volume skipping; progress PUT; ${requests.length} HTTP requests.`);

    if (process.env.READERMATE_SMOKE_VISUAL) {
      await vscode.commands.executeCommand('readermate.configure');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { control.close(); reject(new Error('Visual verification not acknowledged')); }, 180000);
        const control = http.createServer((req, res) => {
          res.end('ReaderMate smoke complete');
          clearTimeout(timer);
          control.close();
          resolve();
        });
        control.once('error', error => { clearTimeout(timer); reject(error); });
        control.listen(19471, '127.0.0.1', () => console.log('READERMATE_VISUAL_READY'));
      });
    }
  } finally {
    require('../../out/extension.js').deactivate();
    await new Promise(resolve => server.close(resolve));
  }
};
