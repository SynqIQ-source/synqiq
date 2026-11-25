# SynqIQ payments: security review packet

Prepared for an independent payments-security review before live card payments (target: December 2026, ahead of the January 1, 2027 billing cutover). Owner: SynqIQ LLC (Texas). First studio: The Preserve (Houston).

This document describes how SynqIQ handles card payments, keys, webhooks and access, so a reviewer can scope and test it without reading the whole codebase. File references are to this repository.

## 1. What SynqIQ is, and what it does with payments

SynqIQ is a studio-management web app (Next.js on Vercel, Postgres on Supabase). For payments it:

- sells retail items, packs and memberships at the front desk (POS) and in the member app;
- saves a member's card for monthly membership dues and charges it each billing date (autopay);
- refunds a sale when staff void it; records disputes (chargebacks).

Stripe is the only payment processor. **SynqIQ never receives, stores or transmits card numbers.**

## 2. Stripe architecture

| Item | Setting |
|---|---|
| Model | Stripe Connect, **Accounts v2**, one connected account per studio, merchant configuration (`card_payments`) |
| Studio dashboard | Full Stripe Dashboard (the studio owns its account) |
| Responsibilities | `fees_collector: stripe`, `losses_collector: stripe` (fixed at creation; `lib/payments/connect.ts`) |
| Charge type | **Direct charges** on the studio's account (`stripeAccount` header) |
| Platform fee | Application fee, default 0.5% (`SYNQIQ_APPLICATION_FEE_BPS`, `lib/payments/checkout.ts`); refunded with a void |
| Onboarding | Stripe-hosted account links, created server-side per click (`onboardingLink`); readiness re-read from Stripe, never assumed from the return URL |
| Live switch | Live studio accounts can only be created with `STRIPE_CONNECT_LIVE=true`; live **renewals** additionally need `SYNQIQ_RENEWALS_LIVE=true` |

The platform (SynqIQ LLC) and each studio are separate Stripe accounts. Test-mode and live data never mix: every query filters on the mode of the server's key (`stripeLivemode()`), and webhooks for the other mode are ignored.

## 3. Card data flow (PCI scope)

Card entry happens only in Stripe-hosted components:

- **Desk and member app:** Stripe Payment Element (`app/dashboard/pos/card-payment.tsx`, `app/m/[studio]/buy/...`, `components/billing/card-update.tsx`). Card fields are Stripe iframes; Stripe Link is disabled (`wallets.link: "never"`); Apple Pay / Google Pay allowed for card updates.
- **Card readers:** Stripe Terminal smart readers (server-driven; `lib/payments/terminal.ts`).
- **Saved cards:** SetupIntents (`usage: off_session`); SynqIQ stores only Stripe IDs (`cus_…`, `pm_…`) and display data (brand, last 4, expiry month/year) in `member_cards`.
- **Mindbody migration:** cards move Mindbody → Stripe through Stripe's secure data-migration process; SynqIQ only receives Stripe's mapping file of IDs (`lib/billing/card-import*.ts`) and verifies each ID against Stripe before saving.

Expected PCI posture for each studio (the merchant): **SAQ A** (all cardholder-data functions outsourced to Stripe via hosted fields). To confirm with Stripe for the Connect setup.

The server never logs card data; error logging prints Stripe error objects, which contain no card numbers (key values are masked by Stripe in error text).

## 4. Keys and secrets

| Secret | Where | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | Vercel env (Production), encrypted "Secret" type | Platform key; mode decides test vs live |
| `STRIPE_PUBLISHABLE_KEY` | Vercel env | Public by design |
| `STRIPE_CONNECT_PAYMENTS_WEBHOOK_SECRET` | Vercel env | Connected-accounts payments destination |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Vercel env | v2 account events destination (thin events) |
| `STRIPE_WEBHOOK_SECRET` | Vercel env | SynqIQ's own subscription billing |
| Supabase service key | Vercel env | Server-only admin client |

Rules: no keys in code, the repository, logs, prompts or chat; local development uses test keys only; CI has no production credentials (tests run against a throwaway local database). **Open items for review:** move the platform key to a **restricted key** with only the permissions SynqIQ uses; document key rotation (Stripe roll + Vercel update + redeploy); limit who has Vercel project access.

## 5. Webhooks

Endpoints (`app/api/stripe/*`):

| Endpoint | Source | Handles |
|---|---|---|
| `/api/stripe/connect-payments` | Connected accounts, snapshot events | `payment_intent.*`, `setup_intent.succeeded`, `charge.refunded`, `charge.dispute.*`, `refund.failed`, `payout.failed` |
| `/api/stripe/connect-events` | Platform, v2 thin events | `v2.core.account*` (re-reads the account) |
| `/api/stripe/webhook` | Platform | SynqIQ's own subscriptions |

Each request: signature verified against the **raw body** with the endpoint secret; events for the other mode or without a connected account are ignored; the event ID is stored first (`stripe_connect_events`, unique) so each event is applied **once**; if handling fails the ID is removed so Stripe's retry runs it again. Event payloads are not trusted for state: payments, setup intents and accounts are **re-read from Stripe** before anything is recorded, so duplicates and out-of-order delivery are harmless.

## 6. Money movement and double-charge protection

- **POS / app sales:** a `pos_card_payments` row is created before Stripe is called (idempotency key per row); the sale is saved only after the PaymentIntent is re-read as `succeeded` with the right amount.
- **Renewals** (`lib/billing/renewal-job.ts`, nightly 4 AM Central + manual "Run renewals now"): a charge row is **claimed** per schedule + billing date (unique key) before Stripe is called; the PaymentIntent idempotency key is per charge + attempt, so re-runs and overlapping runs can't charge twice.
- **Declines:** booking paused at the first decline; retries on days 3, 6 and 10; then the membership goes on hold and no further autopays are attempted until the unpaid month is paid.
- **Bank approval (3D Secure):** off-session `authentication_required` is not treated as a bad card; the member gets a one-time link (`/pay/<token>`) to approve the same PaymentIntent on-session.
- **Refunds:** voiding a card sale refunds through Stripe (including the application fee); a later `refund.failed` emails Club Admins.
- **Disputes:** recorded and listed on Member Billing; a live dispute emails Club Admins with the evidence deadline. Disputes are answered in the studio's Stripe Dashboard.

## 7. Member links (no sign-in)

Card-update (`/card/<token>`) and payment-approval (`/pay/<token>`) links: 24 random bytes (base64url); only a SHA-256 hash is stored; valid 7 days; single use (card-update links for both cards stay open for their 7 days); each link is bound to one studio and member (and, for approvals, one charge). Pages show only first name, studio, membership and amount.

## 8. Access control and audit

- Staff sign in with Supabase Auth; every `/dashboard` route requires a session (middleware), and **row-level security** is enabled on the database tables (136 tables in the baseline schema).
- Roles: **Club Admin** (billing, retries, moving payment dates, card import, approval links, Stripe settings); **Sales Lead** and **Club Admin** can void any sale; other staff only their own sale within 12 hours; staff who can view members can update a member's card (via Stripe's form).
- Records kept: who saved a card and how (`member_cards.updated_via`, `updated_by_staff_id`); who moved a payment date (`moved_by_staff_id`); who voided a sale and why; Stripe event log (`stripe_connect_events`); catalog change log.

## 9. Testing done

- Automated: 420+ unit tests, typecheck and lint on every pull request (GitHub Actions, local test database).
- End-to-end rehearsal in Stripe test mode on production (November 24, 2026): desk card sale and void/refund; card saved for autopay; renewal charged with the 0.5% fee; renewal declined then automatically re-charged after a new card; desk decline; refund failure alert; dispute recorded. All webhooks verified and applied once.

## 10. What we'd like the reviewer to check

1. Tenant isolation: a staff member of one studio can't read or act on another studio's payments, cards or Stripe account (API routes and RLS).
2. Webhook handling: signature checks, replay/duplicate handling, mode separation.
3. The unauthenticated link pages (`/card`, `/pay`) and their APIs: token guessing, reuse, cross-member access.
4. Authorization on payment actions (charge card on file, void/refund, retry, move date, card import).
5. Secrets handling and the restricted-key plan; Vercel and Supabase access.
6. Dependency and header review (CSP for Stripe.js, etc.).

## 11. Known gaps and planned work

- Restricted Stripe key and documented rotation (above).
- Studio-level SAQ A confirmation with Stripe.
- The Mindbody card mapping file format is unknown until Stripe delivers it; the import validates every row against Stripe before saving.
