const BITRATES_KBPS = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
];
const SAMPLE_RATES_HZ = [44100, 48000, 32000];

export class InvalidMp3Error extends Error {}

// Only headers are copied; audio and metadata are skipped within the incoming chunks.
class StreamReader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private chunk: Uint8Array = new Uint8Array();
  private offset = 0;

  constructor(chunks: AsyncIterable<Uint8Array>) {
    this.iterator = chunks[Symbol.asyncIterator]();
  }

  async read(length: number): Promise<Buffer | null> {
    const result = Buffer.alloc(length);
    return (await this.consume(length, result)) ? result : null;
  }

  async skip(length: number): Promise<void> {
    if (!(await this.consume(length))) {
      throw new InvalidMp3Error('The MP3 file is truncated.');
    }
  }

  async close(): Promise<void> {
    await this.iterator.return?.();
  }

  private async consume(length: number, result?: Buffer): Promise<boolean> {
    let consumed = 0;
    while (consumed < length) {
      if (this.offset === this.chunk.length) {
        const next = await this.iterator.next();
        if (next.done) {
          if (consumed === 0) return false;
          throw new InvalidMp3Error('The MP3 file is truncated.');
        }
        this.chunk = next.value;
        this.offset = 0;
      }
      const size = Math.min(length - consumed, this.chunk.length - this.offset);
      result?.set(
        this.chunk.subarray(this.offset, this.offset + size),
        consumed,
      );
      this.offset += size;
      consumed += size;
    }
    return true;
  }
}

function frameLength(header: Buffer): number {
  const second = header.readUInt8(1);
  const third = header.readUInt8(2);
  if (header.readUInt8(0) !== 0xff || (second & 0xe0) !== 0xe0) {
    throw new InvalidMp3Error(
      'Expected an MP3 frame header; found invalid or trailing data.',
    );
  }
  const version = (second >> 3) & 3;
  const layer = (second >> 1) & 3;
  if (version !== 3 || layer !== 1) {
    throw new InvalidMp3Error(
      'Only MPEG Version 1 Audio Layer 3 is supported.',
    );
  }
  const bitrateIndex = third >> 4;
  const bitrate = BITRATES_KBPS[bitrateIndex];
  const sampleRate = SAMPLE_RATES_HZ[(third >> 2) & 3];
  if (bitrate === 0) {
    throw new InvalidMp3Error('Free-format MP3 bitrate is not supported.');
  }
  if (
    bitrate === undefined ||
    sampleRate === undefined ||
    (header.readUInt8(3) & 3) === 2
  ) {
    throw new InvalidMp3Error('The MP3 frame header contains reserved values.');
  }
  const padding = (third >> 1) & 1;
  // MPEG-1 Layer III: floor(144 * bitrate in bits/second / sample rate) + padding.
  return Math.floor((144 * bitrate * 1000) / sampleRate) + padding;
}

async function skipId3(reader: StreamReader): Promise<void> {
  const header = await reader.read(7);
  if (!header) throw new InvalidMp3Error('The ID3 header is truncated.');
  const version = header.readUInt8(0);
  const flags = header.readUInt8(2);
  const allowedFlags = version === 2 ? 0xc0 : version === 3 ? 0xe0 : 0xf0;
  if (
    version < 2 ||
    version > 4 ||
    header.readUInt8(1) === 0xff ||
    (flags & ~allowedFlags) !== 0
  ) {
    throw new InvalidMp3Error('The ID3 header is invalid or unsupported.');
  }
  let size = 0;
  // ID3 sizes use seven bits per byte ("synchsafe"), not a normal 32-bit integer.
  for (const byte of header.subarray(3)) {
    if (byte & 0x80) throw new InvalidMp3Error('The ID3 size is invalid.');
    size = size * 128 + byte;
  }
  await reader.skip(size);
  if (version === 4 && (flags & 0x10) !== 0) {
    const footer = await reader.read(10);
    if (
      !footer ||
      !footer.subarray(0, 3).equals(Buffer.from('3DI')) ||
      !footer.subarray(3).equals(header)
    ) {
      throw new InvalidMp3Error('The ID3 footer is invalid or truncated.');
    }
  }
}

export async function countFrames(
  chunks: AsyncIterable<Uint8Array>,
): Promise<number> {
  const reader = new StreamReader(chunks);
  let frameCount = 0;
  try {
    while (true) {
      const prefix = await reader.read(3);
      if (!prefix) break;
      if (frameCount === 0 && prefix.equals(Buffer.from('ID3'))) {
        await skipId3(reader);
        continue;
      }
      if (frameCount > 0 && prefix.equals(Buffer.from('TAG'))) {
        await reader.skip(125);
        if (await reader.read(1)) {
          throw new InvalidMp3Error(
            'Unexpected data after the final ID3v1 tag.',
          );
        }
        break;
      }
      const lastByte = await reader.read(1);
      if (!lastByte)
        throw new InvalidMp3Error('The MP3 frame header is truncated.');
      const length = frameLength(Buffer.concat([prefix, lastByte]));
      await reader.skip(length - 4);
      frameCount++;
    }
    if (frameCount === 0)
      throw new InvalidMp3Error('The file contains no MP3 frames.');
    return frameCount;
  } finally {
    await reader.close();
  }
}
