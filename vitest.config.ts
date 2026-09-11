import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/db/env.setup.ts"],
    coverage: { provider: "v8", include: ["src/domain/**", "src/connectors/**", "src/lib/**"] },
  },
});
