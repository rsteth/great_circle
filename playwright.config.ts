import { defineConfig, devices } from '@playwright/test';
import { changeCircle } from './src/circle';
import { SELECTION_KEY } from './src/selection';
// Existing geometry regressions intentionally restore the historical selection.
// demo.spec.ts overrides this with empty storage to test actual fresh defaults.
const historicalSelection = changeCircle({ center: { lat: 49.299, lon: -123.133 }, start: { lat: 49.2928, lon: -123.1331 }, radiusM: 3000, targetKm: 10, tolerance: 0.2, surface: 'mixed', style: 'quiet' }, { bearing: 180 });
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:4179', localStorage: [{ name: SELECTION_KEY, value: JSON.stringify({ version: 1, settings: historicalSelection }) }] }] }, baseURL: 'http://127.0.0.1:4179', trace: 'retain-on-failure', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } },
  webServer: { command: 'npm run dev -- --port 4179 --strictPort', url: 'http://127.0.0.1:4179', reuseExistingServer: false },
  projects: [ { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1100 } } }, { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } } ],
});
