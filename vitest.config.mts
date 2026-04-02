import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          WAE_ACCOUNT_ID: "test-account",
          WAE_API_TOKEN: "test-api-token",
          SCRAPE_TOKEN: "test-scrape-token",
        },
      },
    }),
  ],
});
