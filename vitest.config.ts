import { defineConfig } from "vitest/config";

// Unit tests run in Node: pure modules from shared/ and worker/, no Workers runtime and no network.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: { provider: "v8", include: ["shared/holder.ts", "shared/x402client.ts", "worker/proof.ts", "worker/x402.ts", "worker/run.ts"] },
  },
});
