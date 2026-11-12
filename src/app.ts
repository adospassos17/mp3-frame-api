import Fastify, { LogController, type FastifyError } from 'fastify';
import multipart from '@fastify/multipart';
import { countFrames, InvalidMp3Error } from './mp3.js';

export function buildApp({
  maxFileSize = 100 * 1024 * 1024,
  logger = false,
} = {}) {
  const app = Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: true }),
    requestTimeout: 30_000,
  });
  app.register(multipart, {
    limits: { fileSize: maxFileSize, files: 1, fields: 0, parts: 1 },
  });

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof InvalidMp3Error) {
      return reply.code(422).send({ error: error.message });
    }
    if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply
        .code(413)
        .send({ error: `File exceeds the ${maxFileSize}-byte upload limit.` });
    }
    if (error.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
      return reply
        .code(415)
        .send({ error: 'Use multipart/form-data to upload a file.' });
    }
    if (
      ['FST_FILES_LIMIT', 'FST_FIELDS_LIMIT', 'FST_PARTS_LIMIT'].includes(
        error.code,
      )
    ) {
      return reply
        .code(400)
        .send({ error: 'Upload exactly one file, with no additional fields.' });
    }
    if (
      error.message === 'Multipart: Boundary not found' ||
      error.code === 'ERR_STREAM_PREMATURE_CLOSE'
    ) {
      return reply
        .code(400)
        .send({ error: 'The multipart upload is malformed or incomplete.' });
    }
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply
        .code(error.statusCode)
        .send({ error: 'Invalid upload request.' });
    }
    // Do not log uploaded content or return internal error details.
    request.log.error({ code: error.code }, 'Upload processing failed.');
    return reply.code(500).send({ error: 'Unable to process the upload.' });
  });

  app.post('/file-upload', async (request, reply) => {
    let frameCount: number | undefined;
    for await (const part of request.parts()) {
      if (part.type !== 'file') continue;
      try {
        frameCount = await countFrames(
          part.file.iterator({ destroyOnReturn: false }),
        );
      } catch (error) {
        // Finish the file so unread multipart data cannot stall the connection.
        for await (const chunk of part.file) void chunk;
        if (part.file.truncated)
          throw new app.multipartErrors.RequestFileTooLargeError();
        throw error;
      }
      if (part.file.truncated)
        throw new app.multipartErrors.RequestFileTooLargeError();
    }
    if (frameCount === undefined) {
      return reply.code(400).send({ error: 'Upload exactly one MP3 file.' });
    }
    return { frameCount };
  });

  return app;
}
