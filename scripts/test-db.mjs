// Runs every supabase/tests/*.sql file against the LOCAL test database
// (npm run test:db). Build that database first with `npx supabase start` and
// `npm run test:db:setup`; see README.md.
//
// It only connects to localhost / 127.0.0.1 (scripts/lib/local-db.mjs): the
// connection string comes from TEST_DATABASE_URL, defaulting to the local
// Supabase stack. DATABASE_URL and .env.local are not read, so it can't reach
// the hosted project by accident.
//
// Each file runs in one transaction that ends in ROLLBACK (checked by
// npm run test:db:check). Any failed check raises an exception. Exits 1 if any
// file fails, or if there are no test files to run.
import { readdirSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { testDatabase } from "./lib/local-db.mjs";

const db = testDatabase();
const files = readdirSync("supabase/tests").filter((name) => name.endsWith(".sql")).sort();
if (files.length === 0) {
  console.error("No test files found in supabase/tests.");
  process.exit(1);
}

console.log(`Running ${files.length} database tests against ${db.host}`);
let failed = 0;
for (const file of files) {
  const sql = postgres(db.url, { ssl: db.ssl, max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(readFileSync(`supabase/tests/${file}`, "utf8"));
    console.log(`PASS ${file}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${file} - ${error instanceof Error ? error.message : error}`);
  } finally {
    await sql.end();
  }
}
process.exit(failed ? 1 : 0);
