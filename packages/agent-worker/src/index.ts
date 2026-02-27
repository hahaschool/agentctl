import os from 'node:os';

import { createWorkerServer } from './api/server.js';
import { HealthReporter } from './health-reporter.js';
import { createLogger } from './logger.js';

const logger = createLogger('agent-worker');

const PORT = Number(process.env.WORKER_PORT) || 9000;
const HOST = process.env.WORKER_HOST || '0.0.0.0';
const CONTROL_PLANE_URL = process.env.CONTROL_URL || 'http://control:8080';
const MACHINE_ID = process.env.MACHINE_ID || `machine-${os.hostname()}`;

async function main(): Promise<void> {
  const server = await createWorkerServer({ logger });

  const healthReporter = new HealthReporter({
    machineId: MACHINE_ID,
    controlPlaneUrl: CONTROL_PLANE_URL,
    intervalMs: 15_000,
    logger,
  });

  await healthReporter.register();
  healthReporter.start();

  await server.listen({ port: PORT, host: HOST });
  logger.info({ port: PORT, machineId: MACHINE_ID }, 'Agent worker started');

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down...');
    healthReporter.stop();
    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start agent worker');
  process.exit(1);
});
