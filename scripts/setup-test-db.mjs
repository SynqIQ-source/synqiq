// Builds the local test database from scratch (npm run test:db:setup):
//   1. supabase/baseline/schema.sql      structure exported from production
//   2. supabase/baseline/storage.sql     storage buckets + rules (from migrations)
//   3. supabase/baseline/privileges.sql  grants/revokes (from migrations)
//   4. supabase/migrations/* newer than the baseline cutoff, in order
//   5. supabase/tests/fixtures/seed.sql  fake studios, staff and rows
// Only connects to a local database (see scripts/lib/local-db.mjs) and refuses
// to run on a database that has already been set up. Exits 1 on any error,
// naming the file that failed.
import { readdirSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { testDatabase } from "./lib/local-db.mjs";

// Newest migration already included in supabase/baseline/schema.sql.
export const BASELINE_CUTOFF = "20261120290000";

const db = testDatabase();

async function run(file) {
  const sql = postgres(db.url, { ssl: db.ssl, max: 1, onnotice: () => {} });
  const started = Date.now();
  try {
    await sql.unsafe(readFileSync(file, "utf8"));
    console.log(`ok   ${file} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (error) {
    console.error(`FAIL ${file}\n     ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

const check = postgres(db.url, { ssl: db.ssl, max: 1, onnotice: () => {} });
try {
  const [{ exists }] = await check`select to_regclass('public.organizations') is not null as exists`;
  if (exists) {
    console.error(
      "REFUSED: this database already has the SynqIQ schema. Reset it first with `npx supabase db reset` (local only).",
    );
    process.exit(1);
  }
} catch (error) {
  console.error(`Can't reach the test database at ${db.host}: ${error instanceof Error ? error.message : error}`);
  console.error("Start the local stack with `npx supabase start`.");
  process.exit(1);
} finally {
  await check.end();
}

console.log(`Building the test database at ${db.host} (baseline cutoff ${BASELINE_CUTOFF})`);
await run("supabase/baseline/schema.sql");
await run("supabase/baseline/storage.sql");
await run("supabase/baseline/privileges.sql");

const newer = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql") && name.slice(0, 14) > BASELINE_CUTOFF)
  .sort();
console.log(`${newer.length} migration(s) newer than the baseline`);
for (const name of newer) await run(`supabase/migrations/${name}`);

await run("supabase/tests/fixtures/seed.sql");
console.log("Test database ready.");
