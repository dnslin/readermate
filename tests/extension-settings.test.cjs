const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { installVscodeMock } = require('./helpers/vscode.cjs');

async function waitFor(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for bookshelf');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('native settings switch one backend; opening settings preserves connection and credentials', async t => {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push(url.pathname);
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/reader3/getBookshelf') {
      res.end(JSON.stringify({ isSuccess: true, data: [{ name: 'Reader3 book', author: 'A', bookUrl: 'old-book' }] }));
    } else if (url.pathname === '/openapi/v1/shelf') {
      assert.equal(req.headers['x-api-key'], 'lgd_test');
      res.end(JSON.stringify([{ id: 7, name: 'Legado book', author: 'B', bookUrl: 'source-url', durChapterIndex: 1, totalChapterNum: 2 }]));
    } else {
      res.writeHead(404); res.end(JSON.stringify({ error: 'Unexpected route' }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  const fixture = installVscodeMock({ configuration: {
    'readermate.serverUrl': address, 'readermate.username': 'alice', 'readermate.token': 'reader-token',
    'readermate.legado.serverUrl': address, 'readermate.legado.apiKey': 'lgd_test',
    'readermate.preload.enabled': false,
  } });
  const extension = require('../out/extension.js');
  const { ReaderProvider } = require('../out/providers/readerProvider.js');
  t.after(async () => {
    extension.deactivate();
    fixture.context.subscriptions.forEach(item => item.dispose());
    fixture.restore();
    await new Promise(resolve => server.close(resolve));
  });
  extension.activate(fixture.context);
  const view = ReaderProvider.currentViewProvider;
  await waitFor(() => view.bookshelfProvider.getBooks()[0]?.name === 'Reader3 book');
  const oldBook = view.bookshelfProvider.getBooks()[0];
  const originalClient = view.apiClient;
  const cfg = fixture.vscode.workspace.getConfiguration('readermate');
  await cfg.update('legado.apiKey', 'unused-key');
  assert.equal(view.apiClient, originalClient, 'editing inactive backend must not restart active session');
  assert.deepEqual(requests, ['/reader3/getBookshelf']);
  await cfg.update('legado.apiKey', 'lgd_test');
  await cfg.update('backend', 'legado');
  assert.equal(originalClient.isActive, false);
  assert.equal(view.currentBook, undefined);
  await waitFor(() => view.bookshelfProvider.getBooks()[0]?.name === 'Legado book');
  assert.equal(view.apiClient.ownsBook(oldBook), false);
  const afterSwitch = requests.length;
  await fixture.vscode.commands.executeCommand('readermate.openReader', oldBook);
  assert.equal(requests.length, afterSwitch, 'stale tree selection must not reach new backend');
  await cfg.update('token', 'changed-inactive-token');
  assert.equal(requests.length, afterSwitch);

  fixture.vscode.window.showQuickPick = async () => { throw new Error('Settings must not open a separate wizard'); };
  fixture.vscode.window.showInputBox = async () => { throw new Error('Settings must not request duplicate credentials'); };
  const beforeOpening = new Map(fixture.configuration);
  const activeClient = view.apiClient;
  await fixture.vscode.commands.executeCommand('readermate.configure');
  assert.deepEqual(fixture.configuration, beforeOpening);
  assert.equal(view.apiClient, activeClient);
  assert.equal(requests.length, afterSwitch, 'opening settings must not reconnect or overwrite credentials');

  await cfg.update('backend', 'reader3');
  await waitFor(() => view.bookshelfProvider.getBooks()[0]?.name === 'Reader3 book');
  assert.equal(fixture.configuration.get('readermate.token'), 'changed-inactive-token');
  assert.equal(fixture.configuration.get('readermate.legado.apiKey'), 'lgd_test');
  assert.deepEqual(requests, ['/reader3/getBookshelf', '/openapi/v1/shelf', '/reader3/getBookshelf']);

  await cfg.update('serverUrl', '');
  assert.deepEqual(view.bookshelfProvider.getBooks(), []);
  assert.equal(view.apiClient.isActive, true, 'invalid settings must leave the extension configurable');
  await assert.rejects(view.apiClient.getBookshelf(), /服务器地址无效/);
  assert.ok(fixture.commands.has('readermate.configure'));
  await cfg.update('serverUrl', address);
  await waitFor(() => view.bookshelfProvider.getBooks()[0]?.name === 'Reader3 book');
  assert.equal(requests.length, afterSwitch + 2, 'invalid URL must not issue a request or revive an old session');
});
