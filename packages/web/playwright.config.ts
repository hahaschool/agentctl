import { defineConfig } from '@playwright/test';

const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);
const SKIP_WEB_SERVER = process.env.AGENTCTL_PLAYWRIGHT_NO_WEBSERVER === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1, // Dev server recompilation can cause transient ChunkLoadErrors
  use: {
    baseURL: `http://localhost:${String(WEB_PORT)}`,
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: SKIP_WEB_SERVER
    ? undefined
    : {
        command: 'pnpm dev',
        port: WEB_PORT,
        reuseExistingServer: true,
      },
});
