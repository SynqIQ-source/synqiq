import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for lib/ logic (npm test). Database isolation tests are separate:
// npm run test:db (scripts/test-db.mjs runs supabase/tests/*.sql, rolled back).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
