// Lengths in tests are specified independently of the production parser.
export function frame({
  bitrateIndex = 9,
  sampleRateIndex = 0,
  padding = false,
  crc = false,
  length = padding ? 418 : 417,
}: {
  bitrateIndex?: number;
  sampleRateIndex?: number;
  padding?: boolean;
  crc?: boolean;
  length?: number;
} = {}): Buffer {
  const data = Buffer.alloc(length);
  data.set([
    0xff,
    crc ? 0xfa : 0xfb,
    (bitrateIndex << 4) | (sampleRateIndex << 2) | (padding ? 2 : 0),
    0,
  ]);
  return data;
}

export function id3(body: Buffer, version = 4, footer = false): Buffer {
  const header = Buffer.from([
    0x49,
    0x44,
    0x33,
    version,
    0,
    footer ? 0x10 : 0,
    (body.length >> 21) & 0x7f,
    (body.length >> 14) & 0x7f,
    (body.length >> 7) & 0x7f,
    body.length & 0x7f,
  ]);
  const end = footer
    ? Buffer.concat([Buffer.from('3DI'), header.subarray(3)])
    : Buffer.alloc(0);
  return Buffer.concat([header, body, end]);
}

export async function* chunks(data: Buffer, size = data.length || 1) {
  for (let offset = 0; offset < data.length; offset += size) {
    yield data.subarray(offset, offset + size);
  }
}

export const boundary = 'test-upload-boundary';

export function multipartBody(files: Buffer[], extraField = false): Buffer {
  const parts: Buffer[] = [];
  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`,
      ),
      file,
      Buffer.from('\r\n'),
    );
  }
  if (extraField) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="extra"\r\n\r\nvalue\r\n`,
      ),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}
