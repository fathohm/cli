import { configDefaults, defineConfig } from "vitest/config";

// The suite is pure logic and needs no aliases: the shared modules keep the
// `lib/` and `workers/src/` paths their importers already use, so every
// specifier resolves the way it does in the monorepo this tree is generated
// from. Only the built artefacts are kept out.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/dist/**"],
  },
});
