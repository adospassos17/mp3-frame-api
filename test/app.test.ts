import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { buildApp } from '../src/app.js';
import { boundary, frame, multipartBody } from './fixtures.js';

const app = buildApp({ maxFileSize: 2048 });
after(() => app.close());

function upload(files: Buffer[], extraField = false) {
  return app.inject({
    method: 'POST',
    url: '/file-upload',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: multipartBody(files, extraField),
  });
}

test('POST /file-upload returns the exact JSON contract and content type', async () => {
  const response = await upload([
    Buffer.concat([frame(), frame({ padding: true }), frame()]),
  ]);
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['content-type']), /^application\/json/);
  assert.deepEqual(response.json(), { frameCount: 3 });
});

test('rejects a missing file', async () => {
  const response = await upload([]);
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /one MP3 file/);
});

test('rejects empty and disguised non-MP3 files', async () => {
  for (const data of [Buffer.alloc(0), Buffer.from('not actually audio')]) {
    const response = await upload([data]);
    assert.equal(response.statusCode, 422);
    assert.equal(typeof response.json().error, 'string');
  }
});

for (const [name, maxFileSize, file, status] of [
  ['invalid', 2 * 1024 * 1024, Buffer.alloc(1024 * 1024), 422],
  ['oversized', 417, Buffer.concat([frame(), Buffer.alloc(1024 * 1024)]), 413],
] as const) {
  test(
    `finishes a large ${name} upload without blocking shutdown`,
    { timeout: 10_000 },
    async (t) => {
      const server = buildApp({ maxFileSize });
      t.after(async () => {
        server.server.closeAllConnections();
        await server.close();
      });
      const address = await server.listen({ port: 0, host: '127.0.0.1' });
      const response = await fetch(`${address}/file-upload`, {
        method: 'POST',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        body: new Uint8Array(multipartBody([file])),
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, status);
      assert.equal(typeof (await response.json()).error, 'string');

      const valid = await fetch(`${address}/file-upload`, {
        method: 'POST',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        body: new Uint8Array(
          multipartBody([frame({ bitrateIndex: 1, length: 104 })]),
        ),
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(valid.status, 200);
      assert.deepEqual(await valid.json(), { frameCount: 1 });
      assert.notEqual(valid.headers.get('connection'), 'close');

      let forcedShutdown = false;
      const timer = setTimeout(() => {
        forcedShutdown = true;
        server.server.closeAllConnections();
      }, 2000);
      try {
        await server.close();
        assert.equal(
          forcedShutdown,
          false,
          'Shutdown required forced connection cleanup.',
        );
      } finally {
        clearTimeout(timer);
      }
    },
  );
}

test('does not return a partial count for a truncated upload', async () => {
  const response = await upload([
    Buffer.concat([frame(), frame().subarray(0, 100)]),
  ]);
  assert.equal(response.statusCode, 422);
  assert.match(response.json().error, /truncated/);
  assert.equal(response.json().frameCount, undefined);
});

test('rejects multiple files and extra form fields', async () => {
  for (const response of [
    await upload([frame(), frame()]),
    await upload([frame()], true),
    await upload([], true),
  ]) {
    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /exactly one file/);
  }
});

test('rejects oversized uploads even when truncation falls on a frame boundary', async () => {
  const smallApp = buildApp({ maxFileSize: 417 });
  try {
    const response = await smallApp.inject({
      method: 'POST',
      url: '/file-upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody([Buffer.concat([frame(), frame()])]),
    });
    assert.equal(response.statusCode, 413);
    assert.match(response.json().error, /upload limit/);
  } finally {
    await smallApp.close();
  }
});

test('rejects oversized uploads ending within a frame', async () => {
  const response = await upload([
    Buffer.concat(Array.from({ length: 6 }, () => frame())),
  ]);
  assert.equal(response.statusCode, 413);
});

test('requires multipart/form-data', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/file-upload',
    payload: { file: 'audio' },
  });
  assert.equal(response.statusCode, 415);
  assert.match(response.json().error, /multipart\/form-data/);
});

test('rejects malformed multipart requests with a client error', async () => {
  for (const request of [
    {
      headers: { 'content-type': 'multipart/form-data' },
      payload: 'no boundary',
    },
    {
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody([frame()]).subarray(0, 150),
    },
    {
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody([frame()]).subarray(0, -boundary.length - 8),
    },
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/file-upload',
      ...request,
    });
    assert.equal(response.statusCode, 400);
    assert.equal(typeof response.json().error, 'string');
  }
});
