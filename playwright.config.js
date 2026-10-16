import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test/browser",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node test/browser-server.js",
    url: "http://127.0.0.1:3100/health",
    reuseExistingServer: false,
  },
  reporter: "list",
});
