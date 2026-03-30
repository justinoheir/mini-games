import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3001',
    ...devices['iPhone 14'],
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    // Allow AudioContext to start without user gesture (required for headless testing)
    headless: false,
    launchOptions: {
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--use-fake-ui-for-media-stream',      // auto-grant mic/camera permission dialogs
        '--use-fake-device-for-media-stream',  // provide a fake audio stream (no real mic needed)
      ],
    },
  },
  outputDir: 'tests/playwright-artifacts',
});
