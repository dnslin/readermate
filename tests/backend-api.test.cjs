const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { test } = require('node:test');
const { ReaderApiClient } = require('../out/api/readerApi.js');

async function serve(t, handle) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = {
      method: req.method,
      url: new URL(req.url, 'http://localhost'),
      headers: req.headers,
      body: body ? JSON.parse(body) : undefined,
    };
    requests.push(request);
    try {
      await handle(request, res);
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

function json(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function reader3(serverUrl, overrides = {}) {
  return new ReaderApiClient({
    backend: 'reader3', serverUrl, accessToken: 'reader-token',
    appendReader3Path: true, ...overrides,
  });
}

function legado(serverUrl, apiKey = 'lgd_private_test_key') {
  return new ReaderApiClient({ backend: 'legado', serverUrl, apiKey });
}

test('Reader3 preserves paths, token authentication, envelopes and progress payload', async (t) => {
  const bookUrl = 'https://book.example/小说?a=1&b=2';
  const server = await serve(t, ({ url, method, body }, res) => {
    if (url.pathname === '/reader3/getBookshelf') {
      json(res, { isSuccess: true, data: [{ name: 'Reader book', author: 'A', bookUrl }] });
    } else if (url.pathname === '/reader3/getChapterList') {
      json(res, { isSuccess: true, data: [
        { title: '卷一', url: 'volume', index: 0, isVolume: true },
        { title: '第五章', url: 'chapter-five', index: 5 },
      ] });
    } else if (url.pathname === '/reader3/getBookContent') {
      json(res, { isSuccess: true, data: '第一段\n第二段' });
    } else if (url.pathname === '/reader3/saveBookProgress' && method === 'POST') {
      assert.deepEqual(body, { url: bookUrl, index: 5 });
      json(res, { isSuccess: true, data: null });
    } else {
      json(res, { error: 'unexpected endpoint' }, 404);
    }
  });
  const client = reader3(server.url);
  t.after(() => client.dispose());
  const [book] = await client.getBookshelf();
  assert.equal(book.bookUrl, bookUrl);
  assert.equal(book.sourceKey, client.stateKey);
  assert.equal(client.ownsBook(book), true);
  assert.deepEqual((await client.getChapterList(bookUrl)).map(({ index, isVolume }) => ({ index, isVolume })), [
    { index: 0, isVolume: true }, { index: 5, isVolume: undefined },
  ]);
  assert.deepEqual(await client.getBookContent(bookUrl, 5), {
    title: '第6章', content: '第一段\n第二段', nextUrl: undefined, prevUrl: undefined,
  });
  assert.equal(await client.saveBookProgress(bookUrl, 5), undefined);
  assert.equal(server.requests.length, 4);
  for (const request of server.requests) {
    assert.equal(request.url.searchParams.get('accessToken'), 'reader-token');
    assert.match(request.url.searchParams.get('v'), /^\d+$/);
    assert.equal(request.headers['x-api-key'], undefined);
  }
  assert.equal(server.requests[1].url.searchParams.get('url'), bookUrl);
  assert.equal(server.requests[2].url.searchParams.get('url'), bookUrl);
  assert.equal(server.requests[2].url.searchParams.get('index'), '5');
});

test('Reader3 accepts full or custom prefixes, raw responses and text content objects', async (t) => {
  const server = await serve(t, ({ url }, res) => {
    if (url.pathname.endsWith('/getBookshelf')) json(res, null);
    else json(res, { text: '正文\n保留换行' });
  });
  const full = reader3(`${server.url}/reader3/`);
  const custom = reader3(`${server.url}/proxy`, { appendReader3Path: false, accessToken: undefined });
  t.after(() => { full.dispose(); custom.dispose(); });
  assert.deepEqual(await full.getBookshelf(), []);
  assert.equal((await custom.getBookContent('book', 2)).content, '正文\n保留换行');
  assert.deepEqual(server.requests.map(({ url }) => url.pathname), ['/reader3/getBookshelf', '/proxy/getBookContent']);
  assert.equal(server.requests[1].url.searchParams.has('accessToken'), false);
  assert.equal(server.requests[1].url.searchParams.has('v'), false);
});

test('Reader3 rejects failed success envelopes', async (t) => {
  const server = await serve(t, (_, res) => json(res, { isSuccess: false, errorMsg: 'Reader3 token expired' }));
  const client = reader3(server.url);
  t.after(() => client.dispose());
  await assert.rejects(client.getBookshelf(), /Reader3 token expired/);
});

test('Legado uses documented endpoints, original indices, titles and explicit progress writes', async (t) => {
  let savedIndex = 3;
  const book = {
    id: 42, bookUrl: 'remote-book-url-is-not-the-id', name: 'Legado book', author: 'B',
    coverUrl: null, latestChapterTitle: '终章', durChapterIndex: 3, totalChapterNum: 10,
  };
  const server = await serve(t, ({ url, method, body }, res) => {
    if (url.pathname === '/openapi/v1/shelf') json(res, [book]);
    else if (url.pathname === '/openapi/v1/books/42') json(res, { book, chapters: [
      { index: 0, title: '第一卷', isVolume: true },
      { index: 3, title: '开始', isVolume: false },
      { index: 8, title: '第二卷', isVolume: true },
      { index: 9, title: '终章', isVolume: false },
    ] });
    else if (url.pathname === '/openapi/v1/books/42/content') {
      if (url.searchParams.get('saveProgress') !== 'false') savedIndex = Number(url.searchParams.get('index'));
      json(res, { title: '真实标题', content: '第一段\n\n第二段\n', index: 9, prevIndex: 3, nextIndex: null });
    } else if (url.pathname === '/openapi/v1/books/42/progress' && method === 'PUT') {
      savedIndex = body.index;
      json(res, { ok: true });
    } else json(res, { error: 'unexpected endpoint' }, 404);
  });
  const client = legado(server.url);
  t.after(() => client.dispose());
  const [mapped] = await client.getBookshelf();
  assert.equal(mapped.bookUrl, '42');
  assert.equal(mapped.sourceKey, client.stateKey);
  assert.equal(mapped.name, book.name);
  assert.equal(mapped.author, book.author);
  assert.equal(mapped.durChapterIndex, 3);
  assert.equal(mapped.totalChapterNum, 10);
  assert.equal(mapped.latestChapterTitle, '终章');
  const chapters = await client.getChapterList(mapped.bookUrl);
  assert.deepEqual(chapters.map(({ index }) => index), [0, 3, 8, 9]);
  assert.deepEqual(chapters.map(({ isVolume }) => isVolume), [true, false, true, false]);
  const content = await client.getBookContent(mapped.bookUrl, 9);
  assert.equal(content.title, '真实标题');
  assert.equal(content.content, '第一段\n\n第二段\n');
  assert.equal(savedIndex, 3, 'reading/preloading content must not advance server progress');
  assert.equal(await client.saveBookProgress(mapped.bookUrl, 9), undefined);
  assert.equal(savedIndex, 9);
  assert.equal(server.requests.length, 4);
  for (const request of server.requests) {
    assert.equal(request.headers['x-api-key'], 'lgd_private_test_key');
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.url.searchParams.has('accessToken'), false);
    assert.equal(request.url.searchParams.has('api_key'), false);
    assert.equal(request.url.href.includes('lgd_private_test_key'), false);
    assert.equal(request.url.pathname.startsWith('/openapi/v1/'), true);
  }
  assert.deepEqual(server.requests[3].body, { index: 9 });
  assert.equal(server.requests[2].url.searchParams.get('index'), '9');
  assert.equal(server.requests[2].url.searchParams.get('saveProgress'), 'false');
});

test('Legado root and full prefix forms produce one prefix and stable private identities', async (t) => {
  const server = await serve(t, (_, res) => json(res, []));
  const clients = [legado(server.url), legado(`${server.url}/`), legado(`${server.url}/openapi/v1`), legado(`${server.url}/openapi/v1/`)];
  const otherAccount = legado(server.url, 'different-key');
  const otherBackend = reader3(server.url);
  t.after(() => [...clients, otherAccount, otherBackend].forEach((client) => client.dispose()));
  for (const client of clients) {
    await client.getBookshelf();
    assert.equal(client.stateKey, clients[0].stateKey);
    assert.equal(client.stateKey.includes('lgd_private_test_key'), false);
  }
  assert.notEqual(otherAccount.stateKey, clients[0].stateKey);
  assert.notEqual(otherBackend.stateKey, clients[0].stateKey);
  assert.equal(otherAccount.ownsBook({ sourceKey: clients[0].stateKey }), false);
  assert.equal(clients[0].ownsBook({}), false);
  assert.deepEqual(server.requests.map(({ url }) => url.pathname), Array(4).fill('/openapi/v1/shelf'));
});

test('credentials never enter API logs, and Reader3 identities include token and base URL', async (t) => {
  const { logger } = require('../out/utils/logger.js');
  const lines = [];
  logger.init({ appendLine: (line) => lines.push(line) }, 'debug');
  t.after(() => logger.init(undefined, 'info'));
  const apiKey = 'lgd_do_not_log_this';
  const server = await serve(t, (_, res) => json(res, [
    { id: 1, name: apiKey, author: 'A' },
  ]));
  const client = legado(server.url, apiKey);
  const oldAccount = reader3(server.url);
  const sameAccount = reader3(`${server.url}/reader3/`);
  const changedAccount = reader3(server.url, { accessToken: 'changed-token' });
  const changedServer = reader3(`${server.url}/other`);
  t.after(() => [client, oldAccount, sameAccount, changedAccount, changedServer].forEach((api) => api.dispose()));
  await client.getBookshelf();
  assert.equal(lines.join('\n').includes(apiKey), false);
  assert.equal(lines.join('\n').includes('reader-token'), false);
  assert.equal(oldAccount.stateKey, sameAccount.stateKey);
  assert.notEqual(oldAccount.stateKey, changedAccount.stateKey);
  assert.notEqual(oldAccount.stateKey, changedServer.stateKey);
  assert.equal(oldAccount.stateKey.includes('reader-token'), false);
});

test('both protocols reject every non-2xx status and preserve error body context', async (t) => {
  for (const backend of ['reader3', 'legado']) {
    for (const status of [301, 400, 401, 403, 404, 418, 500, 502]) {
      await t.test(`${backend} HTTP ${status}`, async (t) => {
        const server = await serve(t, (_, res) => json(res, { error: `specific failure ${status}` }, status));
        const client = backend === 'reader3' ? reader3(server.url) : legado(server.url);
        t.after(() => client.dispose());
        await assert.rejects(client.getBookshelf(), (error) => {
          assert.match(error.message, new RegExp(`HTTP ${status}`));
          assert.match(error.message, new RegExp(`specific failure ${status}`));
          return true;
        });
        assert.equal(server.requests.length, 1, 'errors must not probe or fall back to the other backend');
      });
    }
  }
});

test('malformed JSON and HTML responses report the response context', async (t) => {
  for (const body of ['not-json', '<html>wrong service</html>']) {
    const server = await serve(t, (_, res) => res.end(body));
    const client = legado(server.url);
    t.after(() => client.dispose());
    await assert.rejects(client.getBookshelf(), (error) => {
      assert.match(error.message, /HTTP 200/);
      assert.equal(error.message.includes(body), true);
      return true;
    });
  }
});

test('network failures preserve their original cause', async (t) => {
  const server = await serve(t, (_, res) => res.socket.destroy());
  const client = legado(server.url);
  t.after(() => client.dispose());
  await assert.rejects(client.getBookshelf(), (error) => {
    assert.ok(error.cause instanceof Error);
    assert.equal(error.cause.code, 'ECONNRESET');
    assert.match(error.message, /socket hang up|ECONNRESET/);
    return true;
  });
});

test('dispose aborts pending and streaming responses and prevents every future endpoint', async (t) => {
  for (const backend of ['reader3', 'legado']) {
    for (const streaming of [false, true]) {
      await t.test(`${backend}, streaming=${streaming}`, { timeout: 5000 }, async (t) => {
        let received;
        let disconnected;
        const receivedRequest = new Promise((resolve) => { received = resolve; });
        const disconnectedRequest = new Promise((resolve) => { disconnected = resolve; });
        const server = await serve(t, (_, res) => {
          res.on('close', disconnected);
          if (streaming) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.write('[');
          }
          received();
        });
        const client = backend === 'reader3' ? reader3(server.url) : legado(server.url);
        t.after(() => client.dispose());
        const rejected = assert.rejects(client.getBookshelf(), /disposed|取消|已停用/i);
        await receivedRequest;
        client.dispose();
        client.dispose();
        assert.equal(client.isActive, false);
        await rejected;
        await disconnectedRequest;
        await assert.rejects(client.getBookshelf(), /disposed|取消|已停用/i);
        await assert.rejects(client.getChapterList('42'), /disposed|取消|已停用/i);
        await assert.rejects(client.getBookContent('42', 9), /disposed|取消|已停用/i);
        await assert.rejects(client.saveBookProgress('42', 9), /disposed|取消|已停用/i);
        assert.equal(server.requests.length, 1);
      });
    }
  }
});

test('Legado rejects unsuccessful progress acknowledgements', async (t) => {
  const server = await serve(t, (_, res) => json(res, { ok: false }));
  const client = legado(server.url);
  t.after(() => client.dispose());
  await assert.rejects(client.saveBookProgress('42', 9), /progress|进度/i);
});

test('invalid URLs keep sessions constructible and reject every operation without requests', async (t) => {
  const server = await serve(t, (_, res) => json(res, []));
  for (const backend of ['reader3', 'legado']) {
    for (const serverUrl of ['', 'not a URL', 'ftp://127.0.0.1/books']) {
      const client = backend === 'reader3' ? reader3(serverUrl) : legado(serverUrl);
      t.after(() => client.dispose());
      assert.equal(client.isActive, true);
      const sameConfig = backend === 'reader3' ? reader3(serverUrl) : legado(serverUrl);
      assert.equal(client.stateKey, sameConfig.stateKey);
      sameConfig.dispose();
      assert.equal(client.stateKey.includes('lgd_private_test_key'), false);
      assert.equal(client.stateKey.includes('reader-token'), false);
      for (const operation of [
        () => client.getBookshelf(),
        () => client.getChapterList('42'),
        () => client.getBookContent('42', 9),
        () => client.saveBookProgress('42', 9),
      ]) {
        await assert.rejects(operation(), (error) => {
          assert.match(error.message, /服务器地址无效/);
          assert.ok(error.cause instanceof Error);
          return true;
        });
      }
      client.dispose();
      assert.equal(client.isActive, false);
      await assert.rejects(client.getBookshelf(), /disposed|已停用/i);
    }
  }
  assert.equal(server.requests.length, 0);
});
