// Runs every supabase/tests/*.sql file against DATABASE_URL. Each file runs in
// one transaction and ROLLS BACK, so it is safe against production; any failed
// check raises an exception. Exit code 1 if any file fails.
//   npm run test:db            (reads DATABASE_URL from .env.local)
import { readdirSync, readFileSync, existsSync } from "node:fs";
import postgres from "postgres";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^DATABASE_URL=(.*)$/);
    if (match) process.env.DATABASE_URL = match[1].replace(/^["']|["']$/g, "");
  }
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

let failed = 0;
for (const file of readdirSync("supabase/tests").filter((name) => name.endsWith(".sql")).sort()) {
  const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, onnotice: () => {} });
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
