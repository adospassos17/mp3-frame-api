# MP3 frame-count API

A small TypeScript API. Fastify handles HTTP/multipart uploads; the MP3 parser is handwritten and uses no audio-parsing packages.

## Start here

**Use two terminals: one runs the server; the other sends uploads. Start the server only once.**

New instances default to **port 3001**, so an old instance on port 3000 can stay running. Send uploads to the new instance on port 3001.

### 1. Check Node before installing

```sh
node --version
```

Requires **Node.js 22.13+** (a current LTS release is recommended). If this prints `v20.10.0`, install a current LTS release from [nodejs.org](https://nodejs.org), **close and reopen PowerShell**, and check again. `npm ci` now stops on an unsupported Node version instead of continuing with many `EBADENGINE` warnings.

### 2. Terminal A: install, verify, and start

Clone the submission repository and enter its directory:

```sh
git clone https://github.com/adospassos17/mp3-frame-api.git
cd mp3-frame-api
```

Then install, verify, and start:

```sh
npm ci
npm run check
npm start
```

`npm ci` installs dependencies; it does **not** start the server. `npm run check` runs checks and builds the application; it does **not** leave a server running. If a check fails, fix it before proceeding to `npm start`.

A successful start prints:

```text
API ready at http://127.0.0.1:3001/file-upload
Keep this terminal open. Upload from another terminal. Press Ctrl+C to stop.
```

The terminal stays busy because the server is waiting for requests. This is expected. For development, use `npm run dev` **instead of** `npm start`, not alongside it.

### 3. Terminal B: upload

Use `curl.exe` on Windows:

```sh
curl.exe -i -F "file=@test\fixtures\tone.mp3" http://127.0.0.1:3001/file-upload
```

A successful response is HTTP 200 with `Content-Type: application/json; charset=utf-8`:

```json
{ "frameCount": 5 }
```

The bundled synthetic tone has five frames. Replace its path with the assessment sample to test that file. On macOS/Linux, use `curl` and `test/fixtures/tone.mp3`. Upload exactly one file using `multipart/form-data`, with no additional form fields. The filename and MIME type are not trusted: the parser checks the bytes.

### If the port is already in use

`Port 3001 is already in use` means the new server **did not start**. An earlier API instance or another application is using that address. If your upload already returns HTTP 200 and `frameCount`, you have a working API instance and can keep using it.

To run the updated code, find its original server terminal, press **Ctrl+C**, then start it again. Do not kill an unknown process. Alternatively, in PowerShell:

```powershell
$env:PORT = '3002'
npm start
```

Then send uploads to `http://127.0.0.1:3002/file-upload`. `PORT` overrides the default of 3001; `Remove-Item Env:PORT -ErrorAction SilentlyContinue` clears a previous override in this terminal.

`HTTP/1.1 100 Continue` in curl output is a normal intermediate response for a file upload; the final `200 OK` and JSON are the result.

If npm reports dependency vulnerabilities, that is separate from Node-version or startup errors. Do not blindly run `npm audit fix --force`; it can introduce breaking changes. The installation/check commands do not establish a security review.

## How the code works

Read these files in order:

1. **`src/server.ts`** starts the server on localhost, port 3001 by default, and closes it on shutdown.
2. **`src/app.ts`** accepts the file stream, calls the counter, and translates failures into JSON responses.
3. **`src/mp3.ts`** contains the algorithm and a small stream reader to handle headers split between network chunks.
4. **`test/mp3.test.ts`** and **`test/app.test.ts`** demonstrate the supported cases and error behavior.

An MP3 is a sequence of audio frames, each starting with a four-byte header. For MPEG-1 Layer III:

```text
frame length in bytes = floor(144 × bitrate in bits/second ÷ sample rate) + padding
```

For example, 128 kbps at 44,100 Hz without padding occupies `floor(144 × 128000 / 44100) = 417` bytes, including its header.

The counter:

1. Skips leading ID3v2 metadata using its declared size.
2. Checks the frame sync bits, MPEG version, layer, bitrate, and sample rate.
3. Calculates the frame length and skips its remaining bytes.
4. Increments the count only after reading the complete frame, then repeats.
5. Allows a final 128-byte ID3v1 tag; rejects other trailing data.

Bitwise shifts extract header fields; masks such as `& 3` retain the two relevant bits. ID3 sizes use seven bits per byte, so `size = size * 128 + byte` reconstructs their size.

The length is recalculated for **every** frame, supporting constant and variable bitrate, padding, mono/stereo, and CRC-bearing frames. Payloads are skipped, not searched: header-like bytes inside audio cannot inflate the count. Xing/Info/VBRI metadata lives inside an MPEG frame, so that physical frame is counted; advertised counts are never trusted.

## Errors and limits

All errors return `{ "error": "description" }`.

| Status | Meaning                                                     |
| ------ | ----------------------------------------------------------- |
| 400    | Missing file, multiple parts, or malformed multipart upload |
| 413    | File exceeds the 100 MiB upload limit                       |
| 415    | Request is not `multipart/form-data`                        |
| 422    | Empty, invalid, truncated, or unsupported MP3               |
| 500    | Unexpected server failure; internal details are not exposed |

Uploads are streamed with backpressure: only the current stream chunk and small headers are retained, not the complete file. Runtime is O(file size), with memory independent of total file size. The server has a 30-second request-receive timeout; the upload limit is defined in `buildApp`.

When MP3 parsing fails, the remaining file stream is consumed before returning the JSON error. This prevents unread request data from blocking shutdown or breaking connection reuse. It uses no whole-file buffer; the upload limit and request timeout still apply. The tradeoff is receiving the rest of a rejected upload instead of replying immediately.

Files are not written to disk and request bodies, filenames, and metadata are not logged. This is an assessment endpoint, **not a production medical-data service**: authentication, TLS, rate limiting, and operational safeguards would need separate requirements before deployment.

## Deliberate boundaries

- Only MPEG-1 Layer III with standard indexed bitrates (32–320 kbps) is supported. Rare free-format bitrate headers are explicitly rejected rather than guessed.
- Leading ID3v2.2/2.3/2.4 tags, ID3v2.4 footers, and final ID3v1 tags are supported. APE tags, arbitrary junk, and damaged-frame recovery are not implemented.
- This counts complete physical frames, not decoded samples. It does not decode audio or verify CRC checksums, so it is not a complete audio-validity checker.
- The assessment's supplied sample returned 6,090 frames in a manual upload reported by the candidate; that count has not been independently verified.

## Verification and submission

`npm run check` runs strict TypeScript checks, ESLint, Prettier, Node's test runner, and the production build. Tests cover chunk boundaries, variable bitrate, metadata, false sync bytes, truncation, upload limits, and a 100,000-frame (~40 MiB) generated stream.

Verification passed on Node 22.23.4: all 50 tests, type checks, lint, formatting, and the production build. Real-HTTP regression tests cover large invalid and oversized uploads, subsequent successful uploads, and shutdown without forced cleanup. Startup tests cover clear readiness, occupied ports without disrupting the existing server, and invalid port configuration. The installed Node 20.10.0 was separately confirmed to receive a clear prerequisite error before startup and installation. Real HTTP uploads returned 5 frames for the bundled CBR tone and 41 for the VBR tone, with JSON headers; a non-MP3 upload returned 422. FFprobe independently reported 5 and 40 audio packets respectively; the VBR file has one additional physical Xing frame before its first audio packet.

The bundled tones were generated with FFmpeg 9.0.2 from a 440 Hz sine wave, at 44.1 kHz stereo: CBR uses 0.1 seconds, 128 kbps, and `-write_xing 0`; VBR uses 1 second and `-q:a 4`. No third-party audio recordings are included.

If FFmpeg is available, generate your own real MPEG-1 sample without a Xing/Info frame and compare physical frame counts:

```sh
ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=1" -c:a libmp3lame -b:a 128k -write_xing 0 sample.mp3
ffprobe -v error -select_streams a:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 sample.mp3
```

With Xing/Info enabled, FFprobe generally excludes that metadata frame; the API includes it because it is physically present. Do not compare playback duration or decoded-frame totals blindly.

The submission includes source code, tests, generated audio fixtures, tooling configuration, this README, and the dependency lockfile. Dependencies, build output, local environment files, and the separate presentation are not included. Git history records the actual submission rather than a reconstructed development history.

References: [MPEG header fields and frame-length formula](https://www.datavoyage.com/mpgscript/mpeghdr.htm), [ID3v2.4 structure](https://id3.org/id3v2.4.0-structure), [Fastify multipart streaming](https://github.com/fastify/fastify-multipart).
