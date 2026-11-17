# SynqIQ onboarding notes (running record)

The raw material for the user guides. Every feature that ships adds what each
role needs to know here; before go-live this becomes the in-app Help section
(role-aware) plus shareable guides. Club Admin notes include where each
dashboard number comes from.

Roles: **Club Admin**, **Sales Lead**, **Sales**, **Trainer**, **Group Fitness
(instructors)**. "Everyone" = all staff.

---

## Everyone

- **Signing in / home screen app**: synqiq.co; add to the phone's home screen
  for the app icon. Club Admins must turn on two-step sign-in (Account).
- **Clock in / out**: button at the top right of every page (time clock feeds
  payroll hours).
- **Message Boards** (Teaching): Announcements (Club Admins post), department
  chats, coverage chats. Club Admins can delete any post.
- **Menu sections**: Teaching, Sales, Fitness, Operations, Insights, Services
  & Pricing, Admin. People only see what their role allows.
- **Report a maintenance issue** (Operations -> Maintenance -> Report an
  issue): pick the equipment (or say where it is), what's wrong, details, and
  add photos and up to 2 short videos (30 seconds total, different angles).
  The equipment's owner and Club Admins are emailed right away; critical
  equipment also sends a phone alert. Anyone can add notes and
  troubleshooting steps on a report.
- **Vendor expected today** shows at the top of Check-in when a maintenance
  vendor is due, so the desk can let them in.

## Group Fitness (instructors)

- **Class Dashboard** (top of Teaching): classes held, average class size,
  fill rate, attendance.
- **My Schedule, Classes**: the class page shows who's booked (Mindbody and
  SynqIQ), check-ins, waitlist; the room map for pick-a-spot rooms.
- **Sub Requests**: ask for a sub / offer to cover; coverage chat per request.
- **Follow Up**: post-class follow-up emails to members (masked email relay).
- **Ratings**: members rate their first class with each instructor each
  quarter. Instructors see their own stars and comments, never who left them,
  next to the club and class-style averages.

## Trainer

- **Fitness section**: Fitness Dashboard (coming), New Members (assigned new
  members and intro sessions), Trainer Health, Trainer Calendar, Trainer Board.
- **Trainer Calendar**: your availability (copied from Mindbody until the
  switch; add extra hours with Hours). Anyone on staff can book you inside your
  hours; only you or a Club Admin can book outside them or double-book (needs a
  reason).
- **Closing out a session**: Complete, No-show, Cancel, Late cancel. Complete,
  no-show and late cancel all record your session pay for that day; an on-time
  cancel doesn't. Pay = pack price / sessions in the pack x your session rate.
- **Trainer Board**: trainers + Club Admins only.

## Sales

- **Check-in**: scan a key card or pick a name; a covered member in good
  standing checks straight in (Undo for 10 seconds). Anyone needing attention
  opens their card.
- **POS**: search a member, guest or lead; personal training and Pilates are
  members-only (needs an active membership or one bought in the same sale).
  Practice mode until payments go live (no card charged).
- **Guests**: only people who have been in the club (kiosk, guest visits,
  trials, appointments). Find a lead box at the top.
- **Lead Status**: the working list. Views: By date range (report), Open leads
  (every lead still being worked, follow-ups due first), Replied (7 days).
  Add lead lives here. Sales see only their own leads.
- **Lead Follow-ups**: who's due today / overdue.
- **Follow-up rules**: the same for every lead, visited or not. Each text,
  email or logged call is a contact attempt; the list shows "attempt 3 of 7".
  Default: 7 attempts on day 0 (within 48 hours), 1, 4, 7, 10, 13, 16. A reply,
  visit or missed appointment starts the attempts over. No reply 2 days after
  the 7th attempt: the lead moves to the **warm lead pool** (Lead Status ->
  Warm pool) and leaves the follow-up lists; they'll get the newsletter and
  quarterly promotions (coming). Setting a follow-up date always wins and
  pulls a lead out of the pool. Imported Gym Sales leads nobody has worked
  yet show "Imported, not worked yet" until worked.
- **Gym Sales history**: a lead's page shows their calls (with notes), texts
  both ways and emails from Gym Sales (May-Nov 2026), newest first. Those
  calls/texts count toward the 7 attempts; their texts back count as replies.
- **Warm pool after the switch from Gym Sales**: leads with no contact in the
  last 30 days (and that came in more than 30 days ago) start in the warm
  pool; contacting one, or setting a follow-up date, brings it back.
- **Texting and email from SynqIQ**: guests see "<your first name> at The
  Preserve"; replies come back into the guest's thread and notify their
  salesperson. Opt-outs are respected.
- **Sales Board**: sales team + Club Admins only.

## Sales Lead

- Everything in Sales, for the whole team (any salesperson's leads).
- **Sales Dashboard**: guest messages from the last 7 days at the top, then
  walk-ins, guests of members, leads, appointments, closing rates by
  salesperson.
- **Cancel class** on a class page (reason is staff-only; booked SynqIQ
  members are released with no fee and get a short apology email).
- Can void sales and waive late cancels.

## Club Admin

- Everything above, plus Admin and Insights.
- **Staff & Roles**: invite staff, set role (Club Admin / Sales Lead / Sales /
  Staff) and tags (Instructor, Trainer).
- **Class Catalog**: class types (photo + description shown to members),
  weekly schedule, calendar (change or cancel a single date), booking rules
  by program, rooms and **room layouts** (pick-a-spot; a main layout per room
  plus layouts for specific class types, e.g. Beat on mats), appointment
  types, website widget and member-booking testers.
- **Products & Inventory**: categories -> sub-categories -> items; prices,
  revenue category (tax/accounting), members-only switch, membership packages
  (registration fee + dues, monthly schedule).
- **Members (profile)**: memberships, Billing tab (upcoming charges with
  Change per charge, billing edits: credit / discount / freeze / cancellation,
  billing test with practice renewals), visits, purchases, personal info.
- **Pay Rates, Payroll, Commissions, Timesheets**: pay per class / class type /
  default; session rates; commission plans and who's on them; payroll by pay
  period with export.
- **Ratings settings**: who gets rating emails (testers / everyone / off).
- **Follow-up timing** (Settings -> CRM): number of attempts, how many are a
  day apart, spacing after that, days before the warm pool; shows the
  resulting schedule; "Back to SynqIQ default".
- **CRM settings**: kiosk iPads (Check-in home-screen app, pair once from the
  icon), website forms, website form spam (Not spam to release), waiver,
  how-did-you-hear options, who sells.

- **Maintenance** (Operations -> Maintenance):
  - *Equipment* tab: add each piece (name, area, model #, serial #, owner who
    gets the alerts, usual vendor, notes) and switch on **Critical** for
    pieces like the steam room. Click a piece for its repair history and
    lifetime cost.
  - *Vendors* tab: company, contact, email, phone, notes.
  - On a report: **Approve and contact a vendor** (Club Admins only) -- the
    first email includes the original report, model/serial, in-house
    troubleshooting and photo/video links. The vendor's replies come back
    into the report's timeline and everyone involved is emailed.
  - **Schedule visit** (date/time), **Vendor is on site**, **Mark resolved**
    (owner or Club Admin). **Quote / Paid** amounts (Club Admins) roll up into
    the equipment's cost history.
  - Reminders: the day before a visit; a critical issue with no vendor
    reply after 24 hours; a visit date that passed with the issue still open.

### Step by step (Club Admin)

**1. Add an employee and give them a login**
1. Admin -> **Staff & Roles** -> **Add employee**.
2. Enter first and last name, **email** (their login invite goes here),
   **mobile**, **role** (Staff, Sales, Sales Lead, Club Admin), optional start
   date, and switch on **Trainer** and/or **Sells** (kiosk + leads).
3. **Add and send invite.** They're emailed right away with a link to log in
   to SynqIQ and set their password. (Club Admins must also set up two-step
   sign-in.) If the email fails, use **Send invite** on their row.
4. They show in the list as "Added in SynqIQ". If they're later added in
   Mindbody with the same email, SynqIQ links the two automatically.
5. Existing staff (from Mindbody): find them, **Manage** under **Role &
   access** to change role/tags, then **Send invite**.
6. Instructors who teach classes: until the Mindbody switch, add them in
   Mindbody (classes still use Mindbody's instructor list); after the switch,
   add them here like anyone else.
7. Next, set their pay (step 2).

**2. Set pay rates (one person can have several)**

Each person can have up to three kinds of pay at once, plus exceptions:
an **hourly** rate (time clock), a **class rate** and a **session rate**.

*First, create the rates the studio uses* (Admin -> **Pay Rates** -> Rates):
1. Under the rates table, fill in a name (e.g. "Peak Incentive", "Pilates
   Group", "Trainer 50%").
2. **For**: Classes or Sessions.
3. **How**:
   - Classes: **Base + per person** (base, amount per person, number of
     people included in the base, optional cap) or **Flat per class**.
     Optional **If nobody comes** amount.
   - Sessions: **% of session value** (pack price / sessions in the pack x
     percent) or **Flat per session**.
4. Save. Rates can be reused by many people.

*Then, who is paid what* (same page, lower card; search the person):
- **Group fitness instructor**: pick their standard **Classes** rate. For
  classes that pay differently, open **Exceptions** -> add one for a
  **class type** (e.g. all Group Reformer -> Pilates rate) or a single
  **class time** (e.g. Tue 6:00 AM Cycle -> Per Class $50). Which wins: class
  time, then class type, then standard rate. Subs are paid their own rate.
- **Trainer**: pick a **Sessions** rate (e.g. 50% of session value). Add an
  **Hourly** rate too if they work paid floor/desk hours, and a Classes rate
  if they also teach. Different rates for some session types -> Exceptions.
- **Sales / front desk**: enter the **Hourly** rate (paid from the time
  clock). Commission is set separately: Admin -> **Commissions** -> **Add
  a plan** (what earns, what it pays), then choose who is on it ("Plan for
  their role" or per person).
- Click **Save** on each person's row.
- Check it: Admin -> **Payroll** for a pay period shows each line and the
  rate used.

**3. Create a class and put it on the schedule**
1. Services & Pricing -> **Class Catalog** -> **Class types** -> **New class type**: name,
   **Program** (sets booking rules and whether membership covers it),
   description (members see it), level, category. Add a photo on the class
   type card.
2. **Weekly schedule** tab -> **Add class time**:
   - **Class** (the class type), **Days** (any days of the week),
     **Starts / Ends**, **Room**, **Spots**, **Instructor**.
   - **First date**: when it starts.
   - **Last date (optional)**: leave empty to repeat every week with no end;
     set a date for a series that stops (e.g. a 6-week program).
3. Save. The class appears on the calendar, the website widget and the
   member app (bookable up to 3 weeks ahead, per the program's booking rules).
4. Change one date only: **Calendar** tab -> open the date (change time,
   instructor, or switch off **Happening** to cancel). Change every week:
   edit the class time on **Weekly schedule**. End it: set a **Last date**,
   or switch off **On the schedule**.
5. Cancel a single class from its class page: **Cancel class** (Club Admins
   and Sales Leads). The reason you type is for staff only; booked members
   get a short apology email without it.

### Numbers explained (to expand before go-live)

- **Class Dashboard**: classes held (Mindbody classes in the period), average
  class size (checked-in clients per class), fill rate (checked in / capacity),
  attendance (checked in / booked). Source: synced Mindbody classes until the
  switch.
- **Lead Status**: "Came in" = first visit, or when added if they haven't
  visited. Time to first contact = came in -> first text/email/logged call
  after it (goal 48 h). Open leads = not a member, not marked not interested,
  not in the warm pool. Warm pool = every attempt made with no reply since
  the last reply / visit / missed appointment (updated nightly at ~4:30 AM).
- **Sales Dashboard**: walk-ins / guests of members = new guests in the period
  by visit type; closed = enrolled in the period; returning = visited again or
  bought in the period after first coming in earlier.
- **Ratings**: averages of 1-5 stars; response rate = rated / emails sent.
- **Payroll**: hourly = time clock x rate; classes = rate by class time > class
  type > default (sub paid their own rate); sessions = pack value x rate;
  commission = commission lines in the period (incl. clawbacks).

---

## Change log (newest first)

- 2026-11-16: Gym Sales activity history imported; old leads sorted into the
  warm pool.
- 2026-11-16: Maintenance module (equipment, vendors, reports with photos/
  video, vendor email relay, visits, quotes/payments, reminders).
- 2026-11-16: Add employee (Staff & Roles) with automatic login invite.
- 2026-11-16: Admin step-by-steps (employee, pay rates, classes); cancel email
  no longer includes the reason.
- 2026-11-16: Follow-up cadence (7 attempts, adjustable) + warm lead pool.
- 2026-11-16: Cancel class button (Club Admins, Sales Leads).
- 2026-11-15: Team boards (Sales, Trainers), admin post delete; menu
  reorganized (Class Dashboard, Fitness section); Lead Status views; lead
  search; POS sells to guests, members-only PT/Pilates; Gym Sales import;
  website spam filter; billing Change per charge; ratings.
