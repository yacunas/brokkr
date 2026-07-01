import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Downloading/starting mongodb-memory-server on first run can be slow.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    // A single in-memory Mongo instance is shared per file; avoid cross-file races.
    fileParallelism: false,
  },
});
