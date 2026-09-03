import { defineConfig, devices } from '@playwright/test'

/**
 * The sub-path smoke test.
 *
 * GitHub Pages serves the app from `/vim-server-satellite/`, and everything
 * that can break there — asset URLs, the favicon, the Entra redirect page —
 * only breaks in a build made with `BASE_PATH` set and served under that path.
 * The dev server used by the main config always serves from the root, so this
 * config runs `vite preview` over `dist/` instead.
 *
 * Build first, with the same BASE_PATH:
 *   BASE_PATH=/vim-server-satellite/ npm run build
 *   BASE_PATH=/vim-server-satellite/ npm run test:subpath
 */
const isCI = !!process.env.CI

const basePath = process.env.BASE_PATH ?? '/vim-server-satellite/'
const port = 4173
const origin = `http://localhost:${port}`

export default defineConfig({
  testDir: 'tests/subpath',
  workers: 1,
  forbidOnly: isCI,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `npm run preview -- --port ${port} --strictPort`,
    // vite.config.ts reads BASE_PATH for preview as well as for the build.
    env: { BASE_PATH: basePath },
    url: `${origin}${basePath}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
})
