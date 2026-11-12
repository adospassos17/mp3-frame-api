import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { boundary, frame, multipartBody } from './fixtures.js';

function startServer(port: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    env: { ...process.env, PORT: port },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  const closed = once(child, 'close');
  child.stderr.on('data', (chunk: Buffer) => {
    errors += chunk.toString();
  });
  const ready = new Promise<string>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match =
        /API ready at (http:\/\/127\.0\.0\.1:\d+)\/file-upload/.exec(output);
      if (match?.[1]) resolve(match[1]);
    });
    child.on('error', reject);
    child.on('close', () =>
      reject(new Error(errors || 'Server exited before becoming ready.')),
    );
  });
  return { child, ready, closed, output: () => output, errors: () => errors };
}

test(
  'startup clearly reports readiness and serves a real HTTP upload',
  { timeout: 10_000 },
  async (t) => {
    const server = startServer('0');
    t.after(async () => {
      server.child.kill();
      await server.closed;
    });
    const url = await server.ready;
    const response = await fetch(`${url}/file-upload`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: new Uint8Array(multipartBody([frame()])),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { frameCount: 1 });
    assert.match(server.output(), /another terminal/);
  },
);

test(
  'an occupied port produces an actionable message without disrupting the existing server',
  { timeout: 10_000 },
  async (t) => {
    const original = startServer('0');
    t.after(async () => {
      original.child.kill();
      await original.closed;
    });
    const url = await original.ready;
    const duplicate = startServer(new URL(url).port);
    t.after(async () => {
      duplicate.child.kill();
      await duplicate.closed;
    });
    await assert.rejects(duplicate.ready, /already in use/);
    const [code] = await duplicate.closed;
    assert.equal(code, 1);
    assert.match(duplicate.errors(), /may already be running/);
    assert.doesNotMatch(duplicate.errors(), /listenInCluster|"stack"/);
    assert.equal((await fetch(url)).status, 404);
  },
);

test(
  'invalid PORT produces a readable startup error',
  { timeout: 10_000 },
  async (t) => {
    const server = startServer('invalid');
    t.after(async () => {
      server.child.kill();
      await server.closed;
    });
    await assert.rejects(server.ready, /PORT must be an integer/);
    assert.equal((await server.closed)[0], 1);
  },
);
