import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Demo Studio: a studio of made-up people for sales demos and videos, so
// The Preserve's members never appear. It has no Mindbody site (the syncs
// skip it). refreshDemoStudio() is idempotent and only ever adds rows:
//
//   - the studio itself, its staff, rooms, programs, marketing sources and
//     member pool (once);
//   - the class schedule through 14 days ahead;
//   - each day's activity since the last run (first run: the last 60 days):
//     class check-ins, sales, PT sessions, new guests with visits, texts,
//     emails and calls, appointments, sales closed and notes;
//   - appointments whose time has passed get an outcome (showed or no-show,
//     and some who showed buy), and yesterday's classes get their sign-ins;
//   - monthly sales targets for this month.
//
// Every random choice comes from a generator seeded by the date, so a day's
// data is the same however many times it's generated.

const DEMO_NAME = "Demo Studio";
const TIMEZONE = "America/Chicago";
const HISTORY_DAYS = 60;
const SCHEDULE_DAYS_AHEAD = 14;

type Admin = ReturnType<typeof createSupabaseAdminClient>;

// --- seeded randomness ----------------------------------------------------------

function seededRandom(seedText: string) {
  let seed = 2166136261;
  for (const char of seedText) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rand = ReturnType<typeof seededRandom>;
const pick = <T,>(rand: Rand, items: readonly T[]) => items[Math.floor(rand() * items.length)];
const between = (rand: Rand, min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
function weighted<T>(rand: Rand, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rand() * total;
  for (const [item, weight] of items) {
    roll -= weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1][0];
}

// --- the studio's fixed shape ----------------------------------------------------

const FIRST_NAMES = [
  "Olivia", "Liam", "Emma", "Noah", "Ava", "Elijah", "Sophia", "James", "Isabella", "Lucas", "Mia", "Mateo",
  "Harper", "Henry", "Evelyn", "Leo", "Camila", "Jack", "Luna", "Daniel", "Nora", "Owen", "Zoe", "Wyatt", "Riley",
  "Caleb", "Layla", "Julian", "Hazel", "Ezra", "Aria", "Miles", "Grace", "Asher", "Chloe", "Hudson", "Stella",
  "Nathan", "Violet", "Isaac", "Aurora", "Dylan", "Lily", "Adrian", "Ellie", "Gabriel", "Naomi", "Eli", "Maya",
] as const;
const LAST_NAMES = [
  "Bennett", "Hayes", "Reed", "Morgan", "Ellis", "Foster", "Graham", "Hart", "Keller", "Lane", "Mercer", "Nash",
  "Parker", "Quinn", "Rhodes", "Sawyer", "Tate", "Vaughn", "Walsh", "Young", "Barrett", "Cole", "Dalton", "Everett",
  "Fleming", "Garrett", "Holland", "Irwin", "Jensen", "Kirby", "Lowell", "Monroe", "Norris", "Porter", "Ramsey",
] as const;

// 1 owner (admin), 2 salespeople, instructors and a personal trainer.
const STAFF = [
  { key: "owner", first: "Jordan", last: "Avery", role: "admin", sells: true, title: "Owner" },
  { key: "sales1", first: "Maya", last: "Chen", role: "instructor", sells: true, title: "Membership Advisor" },
  { key: "sales2", first: "Luis", last: "Ortega", role: "instructor", sells: true, title: "Membership Advisor" },
  { key: "yoga", first: "Priya", last: "Shah", role: "instructor", sells: false, title: "Yoga Instructor" },
  { key: "strength", first: "Ben", last: "Carter", role: "instructor", sells: false, title: "Strength Coach" },
  { key: "pilates", first: "Sofia", last: "Ramos", role: "instructor", sells: false, title: "Pilates Instructor" },
  { key: "hiit", first: "Theo", last: "Brooks", role: "instructor", sells: false, title: "HIIT Coach" },
  { key: "mat", first: "Ava", last: "Nguyen", role: "instructor", sells: false, title: "Pilates Instructor" },
  { key: "pt", first: "Marcus", last: "Lee", role: "instructor", sells: false, title: "Personal Trainer" },
] as const;
type StaffKey = (typeof STAFF)[number]["key"];

const PROGRAMS = [
  { key: "yoga", name: "Yoga", id: 1 },
  { key: "pilates", name: "Pilates", id: 2 },
  { key: "strength", name: "Strength & Conditioning", id: 3 },
] as const;
const ROOMS = [
  { key: "studio", name: "Main Studio", id: 1, capacity: 16 },
  { key: "reformer", name: "Reformer Room", id: 2, capacity: 10 },
  { key: "floor", name: "Training Floor", id: 3, capacity: 14 },
] as const;

// Weekly schedule: weekday (1 = Monday) -> classes.
type Slot = { time: string; name: string; staff: StaffKey; program: (typeof PROGRAMS)[number]["key"]; room: (typeof ROOMS)[number]["key"] };
const WEEKDAY: Slot[] = [
  { time: "06:00", name: "Strength Foundations", staff: "strength", program: "strength", room: "floor" },
  { time: "07:00", name: "Sunrise Yoga Flow", staff: "yoga", program: "yoga", room: "studio" },
  { time: "09:30", name: "Reformer Pilates", staff: "pilates", program: "pilates", room: "reformer" },
  { time: "12:00", name: "HIIT Express", staff: "hiit", program: "strength", room: "floor" },
  { time: "17:30", name: "Vinyasa", staff: "yoga", program: "yoga", room: "studio" },
  { time: "18:30", name: "Pilates Mat", staff: "mat", program: "pilates", room: "studio" },
];
const WEEKEND: Slot[] = [
  { time: "08:00", name: "Weekend Sweat", staff: "hiit", program: "strength", room: "floor" },
  { time: "09:30", name: "Reformer Pilates", staff: "pilates", program: "pilates", room: "reformer" },
  { time: "10:30", name: "Slow Flow Yoga", staff: "yoga", program: "yoga", room: "studio" },
];

const SOURCES = ["Instagram", "Google", "Friend or family", "Drove by", "Facebook", "Event", "Other"] as const;
const MEMBER_POOL = 220;
const MEMBERSHIPS = [
  ["Unlimited Monthly", 189],
  ["8 Classes a Month", 139],
  ["Annual Unlimited", 1899],
  ["Intro Month", 99],
] as const;

const OUTBOUND_TEXTS = [
  "Hi {first}, it's {seller} from Demo Studio! Great meeting you today. Any questions about memberships?",
  "Hey {first}, just checking in. Want me to save you a spot in Thursday's Vinyasa class?",
  "Hi {first}! We have an Intro Month special this week. Want details?",
  "Thanks for coming in, {first}! Let me know when you'd like to come back for a free class.",
];
const INBOUND_TEXTS = [
  "Thanks! Can I try a reformer class first?",
  "Yes please, what time works?",
  "Sounds good, I'll come by this weekend.",
  "What's the price for the 8 class package?",
];
const NOTES = [
  "Interested in morning strength classes. Works downtown.",
  "Training for a half marathon, wants mobility work.",
  "Came with a friend who's a member. Prefers evenings.",
  "Asked about couples pricing.",
  "Price-conscious; follow up with the Intro Month offer.",
];

// --- helpers -------------------------------------------------------------------------

const memberUniqueId = (n: number) => 900000 + n;
const memberClientId = (n: number) => `9100${String(n).padStart(5, "0")}`;
const dayNumber = (day: DateTime) => Number(day.toFormat("yyyyLLdd"));

async function check<T>(promise: PromiseLike<{ data: T; error: unknown }>, what: string): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(`Demo Studio: ${what} failed: ${(error as { message?: string }).message ?? String(error)}`);
  return data;
}

type Base = {
  orgId: string;
  staff: Map<StaffKey, string>;
  rooms: Map<string, string>;
  programs: Map<string, string>;
  locationId: string;
};

// --- one-time setup ----------------------------------------------------------------

async function ensureBase(admin: Admin): Promise<Base & { generatedThrough: string | null }> {
  let org = await check(
    admin.from("organizations").select("id, demo_generated_through").eq("is_demo", true).limit(1).maybeSingle(),
    "finding the demo studio",
  );
  if (!org) {
    org = await check(
      admin
        .from("organizations")
        .insert({ name: DEMO_NAME, timezone: TIMEZONE, is_demo: true, status: "active", primary_color: "#0f766e" })
        .select("id, demo_generated_through")
        .single(),
      "creating the demo studio",
    );
  }
  const orgId = org!.id as string;

  const modules = await check(
    admin.from("org_modules").select("id").eq("organization_id", orgId).eq("module", "crm"),
    "reading modules",
  );
  if (!modules?.length) await check(admin.from("org_modules").insert({ organization_id: orgId, module: "crm" }), "turning on the CRM");

  let location = await check(
    admin.from("Locations").select("id").eq("organization_id", orgId).limit(1).maybeSingle(),
    "reading the location",
  );
  if (!location) {
    location = await check(
      admin
        .from("Locations")
        .insert({ organization_id: orgId, name: "Downtown", timezone: TIMEZONE, active: true, mindbody_location_id: 1 })
        .select("id")
        .single(),
      "adding the location",
    );
  }
  const locationId = location!.id as string;

  await check(
    admin.from("rooms").upsert(
      ROOMS.map((room) => ({ organization_id: orgId, location_id: locationId, name: room.name, active: true, mindbody_resource_id: room.id })),
      { onConflict: "organization_id,mindbody_resource_id", ignoreDuplicates: true },
    ),
    "adding rooms",
  );
  await check(
    admin.from("departments").upsert(
      PROGRAMS.map((program) => ({ organization_id: orgId, location_id: locationId, name: program.name, active: true, mindbody_program_id: program.id })),
      { onConflict: "organization_id,mindbody_program_id", ignoreDuplicates: true },
    ),
    "adding programs",
  );
  await check(
    admin.from("staff").upsert(
      STAFF.map((person, index) => ({
        organization_id: orgId,
        mindbody_staff_id: index + 1,
        first_name: person.first,
        last_name: person.last,
        display_name: `${person.first} ${person.last}`,
        role: person.role,
        can_sell: person.sells,
        title: person.title,
        active: true,
        location_id: locationId,
      })),
      { onConflict: "organization_id,mindbody_staff_id", ignoreDuplicates: true },
    ),
    "adding staff",
  );
  await check(
    admin.from("crm_marketing_sources").upsert(
      SOURCES.map((label, index) => ({ organization_id: orgId, label, sort_order: index, active: true })),
      { onConflict: "organization_id,label", ignoreDuplicates: true },
    ),
    "adding marketing sources",
  );

  // The member pool (Mindbody-style clients).
  const rand = seededRandom("demo-members");
  await check(
    admin.from("clients").upsert(
      Array.from({ length: MEMBER_POOL }, (_, n) => ({
        organization_id: orgId,
        mindbody_unique_id: memberUniqueId(n),
        mindbody_client_id: memberClientId(n),
        first_name: pick(rand, FIRST_NAMES),
        last_name: pick(rand, LAST_NAMES),
        status: n < 150 ? "Active" : pick(rand, ["Non-Member", "Expired", "Inactive"] as const),
        is_prospect: n >= 200,
        creation_date: DateTime.now().minus({ days: between(rand, 30, 900) }).toISO(),
      })),
      { onConflict: "organization_id,mindbody_unique_id", ignoreDuplicates: true },
    ),
    "adding members",
  );

  const [staffRows, roomRows, programRows] = await Promise.all([
    check(admin.from("staff").select("id, mindbody_staff_id").eq("organization_id", orgId), "reading staff"),
    check(admin.from("rooms").select("id, mindbody_resource_id").eq("organization_id", orgId), "reading rooms"),
    check(admin.from("departments").select("id, mindbody_program_id").eq("organization_id", orgId), "reading programs"),
  ]);
  const staff = new Map<StaffKey, string>();
  for (const row of staffRows ?? []) {
    const person = STAFF[Number(row.mindbody_staff_id) - 1];
    if (person) staff.set(person.key, row.id as string);
  }
  const rooms = new Map((roomRows ?? []).map((row) => [ROOMS.find((room) => room.id === row.mindbody_resource_id)!.key as string, row.id as string]));
  const programs = new Map(
    (programRows ?? []).map((row) => [PROGRAMS.find((program) => program.id === row.mindbody_program_id)!.key as string, row.id as string]),
  );
  return { orgId, staff, rooms, programs, locationId, generatedThrough: (org!.demo_generated_through as string | null) ?? null };
}

// --- classes -------------------------------------------------------------------------

// Classes for every day in [from, to]; already-created ones are left alone.
async function ensureClasses(admin: Admin, base: Base, from: DateTime, to: DateTime, now: DateTime) {
  const rows = [];
  for (let day = from.startOf("day"); day <= to; day = day.plus({ days: 1 })) {
    const slots = day.weekday >= 6 ? WEEKEND : WEEKDAY;
    const rand = seededRandom(`classes-${day.toISODate()}`);
    for (const [index, slot] of slots.entries()) {
      const [hour, minute] = slot.time.split(":").map(Number);
      const start = day.set({ hour, minute });
      const room = ROOMS.find((item) => item.key === slot.room)!;
      const capacity = room.capacity;
      const booked = Math.min(capacity, between(rand, Math.floor(capacity * 0.45), capacity));
      const past = start < now;
      const signedIn = past ? Math.max(0, booked - between(rand, 0, 2)) : 0;
      const person = STAFF.find((item) => item.key === slot.staff)!;
      rows.push({
        organization_id: base.orgId,
        mindbody_occurrence_id: dayNumber(day) * 100 + index,
        mindbody_class_schedule_id: index + (day.weekday >= 6 ? 50 : 1),
        class_name: slot.name,
        instructor_name: `${person.first} ${person.last}`,
        start_datetime: start.toUTC().toISO(),
        end_datetime: start.plus({ minutes: 50 }).toUTC().toISO(),
        max_capacity: capacity,
        web_capacity: capacity,
        total_booked: booked,
        total_signed_in: signedIn,
        fill_rate: Number(((booked / capacity) * 100).toFixed(2)),
        attendance_rate: past && booked > 0 ? Number(((signedIn / booked) * 100).toFixed(2)) : null,
        staff_id: base.staff.get(slot.staff) ?? null,
        department_id: base.programs.get(slot.program) ?? null,
        room_id: base.rooms.get(slot.room) ?? null,
        sync_timestamp: now.toUTC().toFormat("yyyy-LL-dd'T'HH:mm:ss"),
      });
    }
  }
  for (let index = 0; index < rows.length; index += 500) {
    await check(
      admin
        .from("class_occurrences")
        .upsert(rows.slice(index, index + 500), { onConflict: "organization_id,mindbody_occurrence_id", ignoreDuplicates: true }),
      "adding classes",
    );
  }
}

// --- one day's activity ------------------------------------------------------------

async function generateDay(admin: Admin, base: Base, day: DateTime, now: DateTime) {
  const rand = seededRandom(`activity-${day.toISODate()}`);
  const at = (hour: number, minute = 0) => day.set({ hour, minute: Math.min(59, minute) });
  const seller = () => weighted(rand, [["sales1", 5], ["sales2", 4], ["owner", 1]] as const);

  // Class check-ins for that day's classes.
  const classes = await check(
    admin
      .from("class_occurrences")
      .select("id, total_signed_in")
      .eq("organization_id", base.orgId)
      .gte("start_datetime", day.toUTC().toISO()!)
      .lt("start_datetime", day.plus({ days: 1 }).toUTC().toISO()!),
    "reading the day's classes",
  );
  const visits = [];
  for (const cls of classes ?? []) {
    const taken = new Set<number>();
    for (let n = 0; n < Number(cls.total_signed_in ?? 0); n += 1) {
      let member = between(rand, 0, 149);
      while (taken.has(member)) member = (member + 1) % 150;
      taken.add(member);
      visits.push({
        organization_id: base.orgId,
        occurrence_id: cls.id,
        client_mindbody_unique_id: memberUniqueId(member),
        signed_in: true,
        synced_at: now.toUTC().toISO(),
      });
    }
  }
  if (visits.length) {
    await check(
      admin.from("class_visits").upsert(visits, { onConflict: "organization_id,occurrence_id,client_mindbody_unique_id", ignoreDuplicates: true }),
      "adding class check-ins",
    );
  }

  // Mindbody-style sales and PT sessions.
  const salesCount = between(rand, 2, 6);
  const sales = Array.from({ length: salesCount }, (_, n) => {
    const [, price] = pick(rand, MEMBERSHIPS);
    return {
      organization_id: base.orgId,
      mindbody_sale_id: dayNumber(day) * 100 + n,
      sales_rep_staff_id: base.staff.get(seller()) ?? null,
      client_id: memberClientId(between(rand, 0, 199)),
      sale_datetime: at(between(rand, 8, 19), between(rand, 0, 59)).toUTC().toISO(),
      total_amount: price,
    };
  });
  await check(
    admin.from("sales").upsert(sales, { onConflict: "organization_id,mindbody_sale_id", ignoreDuplicates: true }),
    "adding sales",
  );
  const sessions = day.weekday >= 7 ? 0 : between(rand, 2, 5);
  const pt = Array.from({ length: sessions }, (_, n) => {
    const start = at(7 + n * 2 + between(rand, 0, 1));
    return {
      organization_id: base.orgId,
      mindbody_appointment_id: dayNumber(day) * 100 + n,
      staff_id: base.staff.get("pt") ?? null,
      location_id: base.locationId,
      client_id: memberClientId(between(rand, 0, 149)),
      session_type_id: 10,
      status: start < now ? (rand() < 0.92 ? "Completed" : "NoShow") : "Booked",
      start_datetime: start.toUTC().toISO(),
      end_datetime: start.plus({ minutes: 50 }).toUTC().toISO(),
      duration_minutes: 50,
    };
  });
  if (pt.length) {
    await check(
      admin.from("appointment_occurrences").upsert(pt, { onConflict: "organization_id,mindbody_appointment_id", ignoreDuplicates: true }),
      "adding PT sessions",
    );
  }

  // New guests and leads, and everything that happens with them, built in
  // memory and written in one insert per table. A day left half-written by
  // an interrupted run is hidden first (contacts can't be deleted, only
  // soft-deleted), so re-running it doesn't show the same people twice.
  await check(
    admin
      .from("crm_contacts")
      .update({ deleted_at: now.toUTC().toISO() })
      .eq("organization_id", base.orgId)
      .gte("created_at", day.toUTC().toISO()!)
      .lt("created_at", day.plus({ days: 1 }).toUTC().toISO()!)
      .is("deleted_at", null),
    "clearing a half-written day",
  );
  const contacts = [];
  const guestVisits = [];
  const messages = [];
  const notes = [];
  const appointments = [];
  const guests = between(rand, day.weekday >= 6 ? 2 : 1, day.weekday >= 6 ? 5 : 4) + (rand() < 0.5 ? 1 : 0);
  for (let n = 0; n < guests; n += 1) {
    const kind = weighted(rand, [["walk_in", 5], ["guest_of_member", 3], ["phone_in", 2], ["web", 2]] as const);
    const visited = kind === "walk_in" || kind === "guest_of_member" || rand() < 0.3;
    const createdAt = at(between(rand, 7, 19), between(rand, 0, 59));
    if (createdAt > now) continue;
    const contactId = randomUUID();
    const first = pick(rand, FIRST_NAMES);
    const last = pick(rand, LAST_NAMES);
    const salesperson = seller();
    const sellerId = base.staff.get(salesperson) ?? null;
    const sellerName = STAFF.find((person) => person.key === salesperson)!.first;
    const smsConsent = rand() < 0.75;
    const email = `${first}.${last}${between(rand, 1, 99)}@example.com`.toLowerCase();

    // Outreach: most get a first contact within 48 hours, some late or never.
    const contactMessages = [];
    const firstContactHours = weighted(rand, [[between(rand, 1, 30), 7], [between(rand, 49, 96), 2], [-1, 1]] as const);
    if (firstContactHours > 0) {
      let when = createdAt.plus({ hours: firstContactHours });
      let count = 0;
      const outreach = between(rand, 1, 4);
      while (when < now && count < outreach) {
        const channel = smsConsent
          ? weighted(rand, [["sms", 5], ["call", 3], ["email", 2]] as const)
          : weighted(rand, [["call", 5], ["email", 4]] as const);
        contactMessages.push({
          organization_id: base.orgId,
          contact_id: contactId,
          channel,
          direction: "outbound",
          subject: channel === "email" ? "Great meeting you at Demo Studio" : null,
          body:
            channel === "call"
              ? pick(rand, ["Left a voicemail.", "Talked about class times; will come back Saturday.", "No answer."])
              : pick(rand, OUTBOUND_TEXTS).replace("{first}", first).replace("{seller}", sellerName),
          sent_by_staff_id: sellerId,
          status: channel === "call" ? "sent" : "delivered",
          read_at: null as string | null,
          created_at: when.toUTC().toISO(),
        });
        if (channel === "sms" && rand() < 0.4 && when.plus({ hours: 2 }) < now) {
          const replyAt = when.plus({ hours: between(rand, 1, 2) });
          contactMessages.push({
            organization_id: base.orgId,
            contact_id: contactId,
            channel: "sms",
            direction: "inbound",
            subject: null,
            body: pick(rand, INBOUND_TEXTS),
            sent_by_staff_id: null,
            status: "received",
            read_at: replyAt.plus({ hours: 1 }) < now ? replyAt.plus({ hours: 1 }).toUTC().toISO() : null,
            created_at: replyAt.toUTC().toISO(),
          });
        }
        when = when.plus({ days: between(rand, 2, 4), hours: between(rand, 0, 5) });
        count += 1;
      }
    }

    // What happened next: ~45% book an appointment (outcome settled once it
    // has passed), some say no, some buy on the spot.
    let outcome: Record<string, unknown> = {};
    if (rand() < 0.45) {
      const scheduled = createdAt
        .plus({ days: between(rand, 1, 7) })
        .set({ hour: between(rand, 9, 18), minute: pick(rand, [0, 30]) });
      appointments.push({
        organization_id: base.orgId,
        contact_id: contactId,
        staff_id: sellerId,
        scheduled_at: scheduled.toUTC().toISO(),
        status: "scheduled",
        created_by_staff_id: sellerId,
        created_at: createdAt.plus({ hours: between(rand, 1, 30) }).toUTC().toISO(),
      });
    } else if (rand() < 0.12 && createdAt.plus({ days: 5 }) < now) {
      outcome = { status: "not_interested", not_interested_at: createdAt.plus({ days: 5 }).toUTC().toISO() };
    } else if (visited && rand() < 0.15) {
      outcome = {
        status: "member",
        closed_at: createdAt.plus({ minutes: 45 }).toUTC().toISO(),
        closed_by_staff_id: sellerId,
        close_source: "manual",
      };
    }

    contacts.push({
      id: contactId,
      organization_id: base.orgId,
      first_name: first,
      last_name: last,
      email,
      email_normalized: email,
      phone_e164: `+1555${String(between(rand, 1000000, 9999999))}`,
      status: visited ? "guest" : "lead",
      source: kind,
      how_heard: [kind === "guest_of_member" ? "Friend or family" : pick(rand, SOURCES)],
      referrer_name_typed: kind === "guest_of_member" ? `${pick(rand, FIRST_NAMES)} ${pick(rand, LAST_NAMES)}` : null,
      assigned_staff_id: sellerId,
      email_consent: rand() < 0.6,
      sms_consent: smsConsent,
      sms_consent_at: smsConsent ? createdAt.toUTC().toISO() : null,
      photo_consent: visited,
      email_check_status: "deliverable",
      mindbody_sync_status: "not_synced",
      created_by_staff_id: visited ? null : sellerId,
      last_message_at: contactMessages.at(-1)?.created_at ?? null,
      created_at: createdAt.toUTC().toISO(),
      updated_at: createdAt.toUTC().toISO(),
      ...outcome,
    });
    messages.push(...contactMessages);
    if (visited) {
      guestVisits.push({
        organization_id: base.orgId,
        contact_id: contactId,
        visit_at: createdAt.toUTC().toISO(),
        visit_type: kind === "guest_of_member" ? "guest_visit" : rand() < 0.2 ? "trial_visit" : "walk_in",
        assigned_staff_id: sellerId,
        created_at: createdAt.toUTC().toISO(),
      });
    }
    if (rand() < 0.35) {
      notes.push({
        organization_id: base.orgId,
        contact_id: contactId,
        author_staff_id: sellerId ?? base.staff.get("owner"),
        body: pick(rand, NOTES),
        created_at: createdAt.plus({ minutes: 20 }).toUTC().toISO(),
      });
    }
  }
  if (contacts.length) await check(admin.from("crm_contacts").insert(contacts), "adding guests");
  if (guestVisits.length) await check(admin.from("guest_visits").insert(guestVisits), "adding visits");
  if (messages.length) await check(admin.from("crm_messages").insert(messages), "adding messages");
  if (notes.length) await check(admin.from("crm_notes").insert(notes), "adding notes");
  if (appointments.length) await check(admin.from("crm_appointments").insert(appointments), "adding appointments");
}

// Appointments whose time has passed: showed (with a visit) or no-show, and
// some who showed buy that day.
async function settleAppointments(admin: Admin, base: Base, now: DateTime) {
  const due = await check(
    admin
      .from("crm_appointments")
      .select("id, contact_id, staff_id, scheduled_at")
      .eq("organization_id", base.orgId)
      .eq("status", "scheduled")
      .lt("scheduled_at", now.minus({ hours: 2 }).toUTC().toISO()!),
    "reading past appointments",
  );
  for (const appointment of due ?? []) {
    const rand = seededRandom(`appointment-${appointment.id}`);
    const at = DateTime.fromISO(appointment.scheduled_at as string);
    if (rand() < 0.7) {
      const visit = await check(
        admin
          .from("guest_visits")
          .insert({
            organization_id: base.orgId,
            contact_id: appointment.contact_id,
            visit_at: at.toUTC().toISO(),
            visit_type: "appointment",
            assigned_staff_id: appointment.staff_id,
            created_at: at.toUTC().toISO(),
          })
          .select("id")
          .single(),
        "adding an appointment visit",
      );
      await check(
        admin.from("crm_appointments").update({ status: "showed", visit_id: visit!.id, updated_at: now.toUTC().toISO() }).eq("id", appointment.id),
        "marking showed",
      );
      if (rand() < 0.45) {
        await check(
          admin
            .from("crm_contacts")
            .update({ status: "member", closed_at: at.plus({ minutes: 50 }).toUTC().toISO(), closed_by_staff_id: appointment.staff_id, close_source: "manual" })
            .eq("id", appointment.contact_id)
            .is("closed_at", null),
          "marking sold after a show",
        );
      }
    } else {
      await check(
        admin.from("crm_appointments").update({ status: "no_show", updated_at: now.toUTC().toISO() }).eq("id", appointment.id),
        "marking no-show",
      );
    }
  }
}

// Classes that have happened since they were created get their sign-ins.
async function settleClasses(admin: Admin, base: Base, now: DateTime) {
  const past = await check(
    admin
      .from("class_occurrences")
      .select("id, mindbody_occurrence_id, total_booked")
      .eq("organization_id", base.orgId)
      .eq("total_signed_in", 0)
      .gt("total_booked", 0)
      .lt("start_datetime", now.toUTC().toISO()!)
      .gte("start_datetime", now.minus({ days: 3 }).toUTC().toISO()!),
    "reading classes to settle",
  );
  for (const cls of past ?? []) {
    const rand = seededRandom(`signin-${cls.mindbody_occurrence_id}`);
    const booked = Number(cls.total_booked);
    const signedIn = Math.max(0, booked - between(rand, 0, 2));
    await check(
      admin
        .from("class_occurrences")
        .update({ total_signed_in: signedIn, attendance_rate: Number(((signedIn / booked) * 100).toFixed(2)) })
        .eq("id", cls.id),
      "settling a class",
    );
  }
}

async function ensureTargets(admin: Admin, base: Base, now: DateTime) {
  const month = now.startOf("month").toISODate()!;
  const targets = [
    ["leads", 90],
    ["contacted", 80],
    ["appointments", 40],
    ["shows", 28],
    ["appointments_closed", 12],
    ["walk_ins", 45],
    ["walk_ins_closed", 8],
    ["enrolled", 25],
    ["calls", 120],
    ["texts", 150],
    ["emails", 60],
  ] as const;
  await check(
    admin.from("crm_kpi_targets").upsert(
      targets.map(([metric, target]) => ({ organization_id: base.orgId, month, staff_id: null, metric, target })),
      { onConflict: "organization_id,month,staff_id,metric", ignoreDuplicates: true },
    ),
    "adding sales targets",
  );
}

export type DemoRefreshResult = { organizationId: string; generatedDays: string[]; generatedThrough: string };

export async function refreshDemoStudio(): Promise<DemoRefreshResult> {
  const admin = createSupabaseAdminClient();
  const now = DateTime.now().setZone(TIMEZONE);
  const today = now.startOf("day");
  const base = await ensureBase(admin);

  const firstDay = base.generatedThrough
    ? DateTime.fromISO(base.generatedThrough, { zone: TIMEZONE }).plus({ days: 1 })
    : today.minus({ days: HISTORY_DAYS });

  await ensureClasses(admin, base, base.generatedThrough ? today.minus({ days: 1 }) : firstDay, today.plus({ days: SCHEDULE_DAYS_AHEAD }), now);

  // Days up to yesterday are generated in full; today stays open so it
  // fills in on the next run (activity after "now" isn't created).
  const generatedDays: string[] = [];
  for (let day = firstDay; day < today; day = day.plus({ days: 1 })) {
    await generateDay(admin, base, day, now);
    generatedDays.push(day.toISODate()!);
    await check(
      admin.from("organizations").update({ demo_generated_through: day.toISODate() }).eq("id", base.orgId),
      "recording progress",
    );
  }
  await settleAppointments(admin, base, now);
  await settleClasses(admin, base, now);
  await ensureTargets(admin, base, now);

  return {
    organizationId: base.orgId,
    generatedDays,
    generatedThrough: generatedDays.at(-1) ?? base.generatedThrough ?? "",
  };
}
