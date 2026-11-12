import { buildApp } from './app.js';

const app = buildApp({ logger: true });
app.log.level = 'error';
const port = Number(process.env.PORT ?? 3001);

try {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }
  const address = await app.listen({ port, host: '127.0.0.1' });
  console.log(`API ready at ${address}/file-upload`);
  console.log(
    'Keep this terminal open. Upload from another terminal. Press Ctrl+C to stop.',
  );
} catch (error) {
  if (
    error instanceof Error &&
    'code' in error &&
    error.code === 'EADDRINUSE'
  ) {
    console.error(
      `Port ${port} is already in use. This API may already be running; try your upload in another terminal.\n` +
        'Otherwise, stop the app using that port, or choose another port with PORT (see README).',
    );
  } else {
    console.error(
      `API could not start: ${error instanceof Error ? error.message : 'Unknown error.'}`,
    );
  }
  process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
  });
}
