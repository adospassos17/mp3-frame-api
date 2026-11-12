import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReadStream } from 'node:fs';
import { countFrames, InvalidMp3Error } from '../src/mp3.js';
import { chunks, frame, id3 } from './fixtures.js';

test('counts a real encoded CBR MP3 (5 frames verified with FFprobe)', async () => {
  const file = new URL('./fixtures/tone.mp3', import.meta.url);
  assert.equal(await countFrames(createReadStream(file)), 5);
});

test('counts a real encoded VBR MP3 including its Xing frame', async () => {
  const file = new URL('./fixtures/tone-vbr.mp3', import.meta.url);
  // FFprobe reports 40 audio packets; the file also contains one Xing frame.
  assert.equal(await countFrames(createReadStream(file)), 41);
});

for (const size of [1, 2, 3, 7, 512, 4096]) {
  test(`counts frames across ${size}-byte stream chunks`, async () => {
    const data = Buffer.concat([frame(), frame({ padding: true }), frame()]);
    assert.equal(await countFrames(chunks(data, size)), 3);
  });
}

test('recalculates frame lengths for variable bitrate, sample rate, padding, and CRC', async () => {
  const data = Buffer.concat([
    frame({ bitrateIndex: 1, length: 104 }), // 32 kbps, 44.1 kHz
    frame({ bitrateIndex: 14, length: 1044 }), // 320 kbps, 44.1 kHz
    frame({ sampleRateIndex: 1, length: 384 }), // 128 kbps, 48 kHz
    frame({ sampleRateIndex: 2, length: 576 }), // 128 kbps, 32 kHz
    frame({ padding: true, crc: true }),
  ]);
  assert.equal(await countFrames(chunks(data, 13)), 5);
});

test('does not mistake frame-like bytes inside payloads for frames', async () => {
  const audio = frame();
  audio.set(frame().subarray(0, 4), 25);
  assert.equal(await countFrames(chunks(audio)), 1);
});

for (const version of [2, 3, 4]) {
  test(`skips ID3v2.${version} metadata without counting its fake frames`, async () => {
    const data = Buffer.concat([id3(frame(), version), frame(), frame()]);
    assert.equal(await countFrames(chunks(data, 11)), 2);
  });
}

test('skips ID3v2.4 footer and final ID3v1 tag', async () => {
  const tag = Buffer.alloc(128);
  tag.write('TAG');
  const data = Buffer.concat([id3(frame(), 4, true), frame(), tag]);
  assert.equal(await countFrames(chunks(data, 3)), 1);
});

test('counts the physical Xing/Info metadata frame, not its advertised frame count', async () => {
  const info = frame();
  info.write('Xing', 36);
  info.writeUInt32BE(1, 40);
  info.writeUInt32BE(9999, 44);
  assert.equal(await countFrames(chunks(Buffer.concat([info, frame()]))), 2);
});

const invalidFiles: [string, Buffer][] = [
  ['empty file', Buffer.alloc(0)],
  ['text instead of MP3', Buffer.from('This is not an MP3')],
  ['metadata only', id3(Buffer.alloc(0))],
  ['truncated frame header', frame().subarray(0, 3)],
  ['truncated audio payload', frame().subarray(0, 416)],
  ['truncated final frame', Buffer.concat([frame(), frame().subarray(0, 100)])],
  ['truncated ID3 header', Buffer.from('ID3')],
  ['truncated ID3 body', id3(frame()).subarray(0, 20)],
  ['truncated ID3v1 tag', Buffer.concat([frame(), Buffer.from('TAG')])],
  ['junk after audio', Buffer.concat([frame(), Buffer.from('junk')])],
  ['partial trailing header', Buffer.concat([frame(), Buffer.from([0xff])])],
];
for (const [name, data] of invalidFiles) {
  test(`rejects ${name} instead of returning a partial count`, async () => {
    await assert.rejects(countFrames(chunks(data, 5)), InvalidMp3Error);
  });
}

for (const [name, byte, value] of [
  ['MPEG-2', 1, 0xf3],
  ['MPEG-2.5', 1, 0xe3],
  ['Layer II', 1, 0xfd],
  ['reserved bitrate', 2, 0xf0],
  ['free-format bitrate', 2, 0x00],
  ['reserved sample rate', 2, 0x9c],
  ['reserved emphasis', 3, 0x02],
] as const) {
  test(`rejects ${name} with an explanation`, async () => {
    const data = frame();
    data[byte] = value;
    await assert.rejects(countFrames(chunks(data)), InvalidMp3Error);
  });
}

test('validates ID3 size bytes and footer', async () => {
  const invalidSize = id3(Buffer.alloc(0));
  invalidSize[6] = 0x80;
  await assert.rejects(countFrames(chunks(invalidSize)), /ID3 size/);
  const invalidFooter = id3(Buffer.alloc(0), 4, true);
  invalidFooter[10] = 0;
  await assert.rejects(countFrames(chunks(invalidFooter)), /ID3 footer/);
  const highBitFooter = id3(Buffer.alloc(0), 4, true);
  highBitFooter[10] = 0xb3;
  await assert.rejects(countFrames(chunks(highBitFooter)), /ID3 footer/);
});

test('propagates stream failures rather than reporting success', async () => {
  async function* brokenStream() {
    yield frame();
    throw new Error('Read failed');
  }
  await assert.rejects(countFrames(brokenStream()), /Read failed/);
});

test('processes a large generated stream without collecting the whole file', async () => {
  async function* largeStream() {
    const audio = frame();
    for (let i = 0; i < 100_000; i++) yield audio;
  }
  assert.equal(await countFrames(largeStream()), 100_000);
});
