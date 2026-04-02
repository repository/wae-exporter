import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: ["api/", "dist/"],
  options: {
    typeAware: true,
  },
  settings: {
    vitest: {
      typecheck: true,
    },
  },
});
