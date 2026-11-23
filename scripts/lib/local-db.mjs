// Shared guard for the database test scripts: they only ever connect to a
// database on this machine.
//
// The connection string comes from TEST_DATABASE_URL, defaulting to the local
// Supabase stack started by `npx supabase start`. DATABASE_URL and .env.local
// are deliberately NOT read, so a developer whose shell or .env.local points
// at the hosted project can't reach it by accident.
//
// A non-local host is refused unless ALLOW_REMOTE_TEST_DB=1 is set (e.g. a
// separate, throwaway test project). The production project is refused even
// then.

export const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PRODUCTION_PROJECT_REF = "jmskgyrybaawyvndcdpp";

function refuse(message) {
  console.error(`\nREFUSED: ${message}\n`);
  process.exit(1);
}

/** Returns { url, ssl } for a database the tests are allowed to use, or exits. */
export function testDatabase() {
  const url = process.env.TEST_DATABASE_URL || LOCAL_DATABASE_URL;
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    refuse("TEST_DATABASE_URL is not a valid postgres:// connection string.");
  }
  if (url.includes(PRODUCTION_PROJECT_REF)) {
    refuse("TEST_DATABASE_URL points at the production Supabase project. The database tests never run there.");
  }
  const local = LOCAL_HOSTS.has(host);
  if (!local && process.env.ALLOW_REMOTE_TEST_DB !== "1") {
    refuse(
      `TEST_DATABASE_URL points at "${host}", which is not this machine.\n` +
        "The database tests only run against a local database (localhost or 127.0.0.1).\n" +
        "Start one with `npx supabase start`, or set ALLOW_REMOTE_TEST_DB=1 to use a separate, throwaway test database.",
    );
  }
  return { url, ssl: local ? false : "require", host };
}
