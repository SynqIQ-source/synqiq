-- The agreement text members accept for each plan, from Mindbody's contract
-- templates (AgreementTerms), as plain text with any sample member details
-- Mindbody fills into its preview removed (lib/memberships/contracts.ts
-- cleanAgreementTerms). Starting point for SynqIQ's own agreements.
alter table membership_plans
  add column if not exists agreement_terms text;
