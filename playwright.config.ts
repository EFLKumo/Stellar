import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./apps/web/tests",
  testMatch: "**/*.spec.ts",
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.TEST_APP_ORIGIN ?? "http://localhost:3000",
    actionTimeout: 15000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
