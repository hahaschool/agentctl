import { createServer } from './api/server.js';
import { createLogger } from './logger.js';

const logger = createLogger('control-plane');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

async function main(): Promise<void> {
  const server = await createServer({ logger });

  await server.listen({ port: PORT, host: HOST });
  logger.info({ port: PORT, host: HOST }, 'Control plane started');
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start control plane');
  process.exit(1);
});
