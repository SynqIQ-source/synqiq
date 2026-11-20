# Mindbody integration: inventory and off-ramp

Last updated 2026-11-19. Mindbody API access for The Preserve ends **2027-01-23**.
This lists everything SynqIQ reads from or sends to Mindbody, where the data
lands in SynqIQ, and what replaces it, so the integration can be switched off
in one step and then deleted.

## Switching it off

| Switch | Effect |
|---|---|
| **Settings > Mindbody connection** (per studio, `organizations.mindbody_disconnected_at`) | Every Mindbody call for that studio's site is refused inside `MindbodyClient.request` (`lib/mindbody/connection.ts`); every sync, the booking write-back, the 15-minute count refresh and the session-pack import skip the studio. Data already copied into SynqIQ stays. Reversible. |
| `MINDBODY_DISABLED=true` (environment) | Same, for every studio. Use when the code is about to be deleted. |
| Settings > Copy SynqIQ bookings into Mindbody | Just the booking write-back (stops by itself after its last day, default 2027-01-21). |

Every Mindbody HTTP call goes through **one method**, `MindbodyClient.request`
in `lib/mindbody/client.ts`, so the switch can't be bypassed.

## What SynqIQ sends to Mindbody (writes)

| What | Code | Notes |
|---|---|---|
| New client for a guest/lead who joins (member ID) | `lib/crm/mindbody-push.ts`, `lib/members/ids.ts` (`ensureMemberId`, source `mindbody`) | Approved CRM push. After go-live: `organizations.member_id_source = 'synqiq'` (SynqIQ's own numbering, built and tested). |
| Class booking / waitlist / cancel | `lib/booking/mindbody-push.ts` (`addClientToClass`, `removeClientFromClass`) | Transition only, switch in Settings, ends 2027-01-21. |
| Substitute teacher | `app/api/substitution-requests/[id]/select/route.ts` (`substituteClassTeacher`) | Keeps Mindbody's schedule right while Mindbody runs the schedule. Not needed once SynqIQ owns the schedule. |

## What SynqIQ reads (nightly syncs, `vercel.json` crons)

| Cron route | Code | Copies into | After Jan 23 |
|---|---|---|---|
| `/api/sync/classes` | `lib/sync/classes.ts` | `class_occurrences`, `departments`, `rooms`, `staff` | **Gap: SynqIQ must own the class schedule** (see below). |
| `/api/sync/class-catalog` | `lib/sync/class-catalog.ts` | `class_types`, `rooms` | Edited in SynqIQ (Class Catalog). |
| `/api/sync/class-calendar` | `lib/sync/class-calendar.ts` | `class_schedules`, `class_sessions` (SynqIQ's bookable calendar) | **Gap**: series come from Mindbody today. |
| `/api/sync/class-visits` | `lib/sync/class-visits.ts` | `class_visits_mindbody` (+ view `class_visits`) | SynqIQ bookings/check-ins (`class_bookings`) already feed the `class_visits` view and `synqiq_signed_in`. |
| `/api/sync/class-counts` (15 min, studio hours) | `lib/sync/class-counts.ts` | `class_occurrences.total_booked` | Not needed once members book only in SynqIQ. |
| `/api/sync/clients` | `lib/sync/clients.ts` | `clients` (roster, status, opted-in emails) | SynqIQ members (`crm_contacts`, member profiles). |
| `/api/sync/member-contracts` | `lib/sync/member-contracts.ts` | `member_contracts`, `membership_plans` | SynqIQ billing schedules (Jan 1 cutover). |
| `/api/sync/member-profiles` | `lib/sync/member-profile-nightly.ts`, `member-profile.ts` | `member_visits`, `member_sales`, `member_services`, `member_personal` | Visits: SynqIQ check-ins/bookings. Packs: `session_packs` (owns balances from 2026-12-18). Profile details: SynqIQ edits. |
| `/api/sync/member-photos` | (member photos) | `member_personal.photo_path` | Photos taken in SynqIQ (kiosk/profile). |
| `/api/sync/sales` | `lib/sync/sales.ts` | `sales`, `sale_items` | SynqIQ POS (`pos_sales`). |
| `/api/sync/appointments` | `lib/sync/appointments.ts` | `appointment_occurrences` | SynqIQ PT sessions (`trainer_sessions`). |
| `/api/sync/trainer-availability` | `lib/trainer/availability-sync.ts` | `trainer_availability` | Hours added in SynqIQ (trainer calendar). |
| `/api/sessions/import-mindbody` | `lib/sessions/packs.ts` | `session_packs` (from `member_services`, no API call) | Stops by itself on the switch date. |

Other reads (live, on demand): check-in coverage (`lib/checkin/status.ts`),
class detail roster (`app/dashboard/classes/[occurrenceId]/page.tsx`),
post-class reminders (`lib/followup/post-class-reminders.ts`), new-member
onboarding (`lib/crm/onboarding.ts`), POS pricing options (`lib/pos/catalog.ts`),
site activation (`lib/mindbody/activation.ts`), admin debug routes
(`app/api/mindbody/classes|class-visits|staff`).

## Data kept after Mindbody

Everything above is **copied** into SynqIQ's database, not read live, so it
stays after the switch. Before Jan 23, run one last full pull (all clients:
profiles, full visit and purchase history, services/balances) and request
Mindbody's Subscriber Data Export (cards, waiver status, documents).

## Gaps to close before Jan 23

1. **Class schedule.** Class series and their occurrences (`class_occurrences`,
   `class_schedules`/`class_sessions`) still come from Mindbody. SynqIQ needs
   its own series editor: day/time, instructor, room, capacity, start date and
   an **optional end date** (allowed, never required; Mindbody forces one).
   Dashboards, payroll, substitutions and the heat map key off
   `class_occurrences`, so SynqIQ-created classes must produce those rows too.
2. **Clients roster.** New people only enter `clients` through the Mindbody
   sync; SynqIQ-only members live in `crm_contacts`. One SynqIQ member record
   (and `member_id_source = 'synqiq'`) before the switch.
3. **Appointments.** PT is in SynqIQ (`trainer_sessions`); any other
   appointment types still booked in Mindbody need a home.
4. **Live checks** (check-in coverage, class roster) fall back to SynqIQ's
   copies when Mindbody can't be reached; confirm each with the switch off.

## Deleting the code afterwards

With the switch off and no errors for a couple of weeks: remove the crons
above from `vercel.json`, delete `lib/sync/*`, `lib/mindbody/*`,
`app/api/sync/*`, `app/api/mindbody/*` and the write paths listed, then
remove `MINDBODY_*` environment variables. Keep the copied tables (they're
history).
