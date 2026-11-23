// Checks that every database test (supabase/tests/*.sql) ends with ROLLBACK
// and never COMMITs, so no test can leave rows behind in whatever database it
// runs on (npm run test:db:check). Runs in CI before the database tests.
// Comments are ignored. Exits 1 and names each bad file.
import { readdirSync, readFileSync } from "node:fs";

const dir = "supabase/tests";
const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
if (files.length === 0) {
  console.error(`No test files found in ${dir}.`);
  process.exit(1);
}

let bad = 0;
for (const name of files) {
  const code = readFileSync(`${dir}/${name}`, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
    .trim();
  const problems = [];
  if (!/(^|\n)\s*rollback\s*;\s*$/i.test(code)) problems.push("does not end with ROLLBACK");
  if (/\bcommit\b/i.test(code)) problems.push("contains COMMIT");
  if (/\bend\s+(transaction|work)\b/i.test(code)) problems.push("contains END TRANSACTION/WORK (same as COMMIT)");
  if (problems.length) {
    bad += 1;
    console.log(`FAIL ${name}: ${problems.join("; ")}`);
  } else {
    console.log(`ok   ${name}`);
  }
}
if (bad) {
  console.error(`\n${bad} test file(s) could leave changes behind. Every test must end with ROLLBACK and never COMMIT.`);
  process.exit(1);
}
