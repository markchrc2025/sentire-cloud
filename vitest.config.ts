import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/sentire_cloud_test",
      APP_URL: "http://localhost:3999",
      KEY_ENCRYPTION_KEY: "0".repeat(64),
      SESSION_SECRET: "test-session-secret-test-session-secret",
      NODE_ENV: "test",
    },
  },
});
