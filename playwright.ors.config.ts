import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: './tests/browser-ors', workers: 1, fullyParallel: false, timeout: 30000,
 use: { baseURL: 'http://127.0.0.1:4180', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } },
 webServer: [{ command: 'env -u ORS_API_KEY -u ORS_KEYCHAIN_SERVICE npm run dev:server', url: 'http://127.0.0.1:8787/api/health', reuseExistingServer: false }, { command: 'npm run dev -- --port 4180 --strictPort', url: 'http://127.0.0.1:4180', reuseExistingServer: false }],
 projects: [{ name: 'desktop', use: { viewport: { width: 1440, height: 1100 } } }, { name: 'phone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
});
