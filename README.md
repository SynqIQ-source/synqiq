# SynqIQ

## Database tests (run locally)

The 16 SQL tests in `supabase/tests/` check who can see and change what,
including that one studio never sees another studio's data. They run only
against a **local** database on your machine, never the hosted Supabase project.
CI does the same thing on every push and pull request
(`.github/workflows/ci.yml`).

You need Docker running (Docker Desktop on Windows/macOS) and Node.

```sh
npx supabase@2.122.1 start         # local Supabase in Docker
npm run test:db:setup              # build the test database (once per start)
npm run test:db                    # run the 16 tests
npm run test:db:check              # every test ends in ROLLBACK, no COMMIT
```

To start again from an empty database: `npx supabase@2.122.1 db reset`, then
`npm run test:db:setup`. Stop the stack with `npx supabase@2.122.1 stop`.

### Safety

- The scripts read `TEST_DATABASE_URL`, which defaults to the local stack
  (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`). They do **not**
  read `DATABASE_URL` or `.env.local`.
- They refuse any host other than `localhost` / `127.0.0.1` unless
  `ALLOW_REMOTE_TEST_DB=1` is set (for a separate, throwaway test project).
  The production project is refused even then.
- The fake seed refuses to load into a database that already has studios or
  users in it.
- Each test runs in one transaction that ends in `ROLLBACK`.

### How the test database is built

The migrations in `supabase/migrations/` can't build a database from zero:
the first tables (`organizations`, `staff`, `members`, `class_occurrences`,
`locations`…) were made in the Supabase dashboard before migrations started,
and the first migration changes them. So `npm run test:db:setup` loads, in
order:

1. `supabase/baseline/schema.sql`: the structure of the `public` and `private`
   schemas exported from production on 2026-11-23 (schema only: no data, no
   owners, no grants).
2. `supabase/baseline/storage.sql`: storage buckets and rules, rebuilt from
   the migrations.
3. `supabase/baseline/privileges.sql`: grants and revokes, rebuilt from the
   migrations.
4. Every migration **newer than `20261120290000`**, in order.
5. `supabase/tests/fixtures/seed.sql`: fake studios ("Test Studio A" standing
   in for The Preserve, a demo studio, and "Test Studio B"), staff in each
   role, and the rows the tests look for.

**Where the cutoff comes from:** production has no
`supabase_migrations.schema_migrations` entries (migrations were run by hand
in the SQL editor), so there is no record of which migrations were applied.
The cutoff was derived from the export instead: everything created by all 136
migrations up to `20261120290000` is in it, and the few objects that aren't
were dropped by later migrations.

**When you add a migration:** nothing to do. CI applies it on top of the
baseline, so a migration that fails on a clean database fails CI. If it adds a
storage bucket or storage rule, copy that into `supabase/baseline/storage.sql`
too.
