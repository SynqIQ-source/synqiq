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
- **Menu sections**: Teaching, Sales, Fitness, Insights, Services & Pricing,
  Admin. People only see what their role allows.

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
- **Follow-up rules** (current): first contact within 48 hours of coming in;
  leads who haven't visited: daily for the first 7 days, then every 3 days;
  visited guests: every 2 days for the first 14 days, then every 3 days. A
  follow-up date you set wins. Imported Gym Sales leads nobody has worked yet
  show "Imported, not worked yet" until worked.
- **Texting and email from SynqIQ**: guests see "<your first name> at The
  Preserve"; replies come back into the guest's thread and notify their
  salesperson. Opt-outs are respected.
- **Sales Board**: sales team + Club Admins only.

## Sales Lead

- Everything in Sales, for the whole team (any salesperson's leads).
- **Sales Dashboard**: guest messages from the last 7 days at the top, then
  walk-ins, guests of members, leads, appointments, closing rates by
  salesperson.
- **Cancel class** on a class page (with a reason; booked SynqIQ members are
  released with no fee and emailed).
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
- **CRM settings**: kiosk iPads (Check-in home-screen app, pair once from the
  icon), website forms, website form spam (Not spam to release), waiver,
  how-did-you-hear options, who sells.

### Numbers explained (to expand before go-live)

- **Class Dashboard**: classes held (Mindbody classes in the period), average
  class size (checked-in clients per class), fill rate (checked in / capacity),
  attendance (checked in / booked). Source: synced Mindbody classes until the
  switch.
- **Lead Status**: "Came in" = first visit, or when added if they haven't
  visited. Time to first contact = came in -> first text/email/logged call
  after it (goal 48 h). Open leads = not a member, not marked not interested.
- **Sales Dashboard**: walk-ins / guests of members = new guests in the period
  by visit type; closed = enrolled in the period; returning = visited again or
  bought in the period after first coming in earlier.
- **Ratings**: averages of 1-5 stars; response rate = rated / emails sent.
- **Payroll**: hourly = time clock x rate; classes = rate by class time > class
  type > default (sub paid their own rate); sessions = pack value x rate;
  commission = commission lines in the period (incl. clawbacks).

---

## Change log (newest first)

- 2026-11-16: Cancel class button (Club Admins, Sales Leads).
- 2026-11-15: Team boards (Sales, Trainers), admin post delete; menu
  reorganized (Class Dashboard, Fitness section); Lead Status views; lead
  search; POS sells to guests, members-only PT/Pilates; Gym Sales import;
  website spam filter; billing Change per charge; ratings.
