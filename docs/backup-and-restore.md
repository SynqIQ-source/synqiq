# Backup and restore (production database)

Last checked: 2026-11-23, Supabase **Pro** plan, project `jmskgyrybaawyvndcdpp`.

## What is backed up

| What | Backed up? | Where |
|---|---|---|
| Database: members, contracts, staff, CRM, payroll, sign-in accounts, security rules | **Yes**, daily | Supabase, Database → Backups → Scheduled backups |
| Uploaded files: signed waiver PDFs, member/staff photos, logos, maintenance media | **No** | Only in Supabase Storage. See "Gaps" below. |
| App code | Yes | GitHub |
| App settings and secrets (Supabase keys, Stripe, Twilio, Resend, Mindbody) | Not by Supabase | Vercel project settings (keep a copy in the password manager) |
| Scheduled jobs (syncs, reminders, billing) | Yes | `vercel.json`, in GitHub. They run on Vercel, not in the database. |

- **Schedule:** one backup a day at about **08:40 UTC (2:40 AM Central)**.
- **Kept:** the last **7 days**. On 2026-11-23 there were 8 listed (Nov 16 to 23), all "COMPLETED".
- **Type:** a physical copy of the whole database, including sign-in accounts.

## Check it's working (monthly, 2 minutes)

1. Supabase → project → **Database → Backups → Scheduled backups**.
2. Confirm there's a backup from **today or yesterday**. If the newest one is older than 2 days, contact Supabase support.

## Option A: undo a mistake, same project (most common)

Use this for bad data, a mistaken bulk delete, or a broken migration.

1. **Decide which day** to go back to. Everything changed after that backup is lost: bookings, sales, check-ins, CRM notes and texts. Note roughly what happened since, so staff can re-enter it.
2. Tell staff to stop using SynqIQ. The site goes down during the restore.
3. Supabase → **Database → Backups → Scheduled backups** → **Restore** on the chosen day → confirm.
4. Wait for the project to come back. It can take a few minutes up to an hour or more.
5. **Check:** sign in, open the dashboard, look up a few members, and check today's classes and sales.
6. Nothing else needs changing: same project, same keys, same addresses.

Files (waivers, photos) are untouched by this. Files deleted after that backup stay deleted.

## Option B: Supabase project is broken or gone, restore to a NEW project

Use this when the project can't be restored in place, or to look at old data without touching production.

1. Supabase → **Database → Backups → Restore to new project** (beta) → **Restore** on the chosen day. This creates a separate project, which is billed while it exists.
2. In the new project: **Settings → API**. Copy the new **Project URL**, **anon key** and **service_role key**.
3. In **Vercel** → project → Settings → Environment Variables (Production), replace:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

   Then **redeploy**.
4. In the new project, re-check settings that live outside the database:
   - **Authentication → URL configuration:** site URL and redirect URLs.
   - **Authentication → SMTP:** the Resend sender settings, and the email templates.
5. **Files:** the new project won't have the uploaded files. Re-upload them from the file backup (see Gaps). Until then, waiver PDFs and photos will be missing.
6. Check as in Option A.

Webhooks from Stripe, Twilio, Resend and Mindbody point at the SynqIQ website, not at Supabase, so they don't need changing.

## Gaps (next phase)

1. **Uploaded files have no backup.** Signed waivers in particular should be copied off Supabase regularly.
2. **Every copy lives inside Supabase.** If the Supabase account itself is unavailable, there's nothing to restore from. Planned next: a nightly encrypted copy (database and files) kept on the office PC and off-site.
3. **Only 7 days.** A problem noticed after a week can't be undone. The own-copy backup above fixes this too.
4. **Restore drill.** Neither option has been tried yet. Do a practice "Restore to new project" once, check it, then delete that project.
