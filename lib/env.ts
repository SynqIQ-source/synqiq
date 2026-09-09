type EnvKey =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "MINDBODY_API_BASE_URL"
  | "MINDBODY_API_KEY"
  | "MINDBODY_SITE_ID"
  | "MINDBODY_USERNAME"
  | "MINDBODY_PASSWORD"
  | "CRON_SECRET"
  | "NEXT_PUBLIC_SITE_URL"
  | "RESEND_API_KEY"
  | "LEAD_NOTIFICATION_EMAIL"
  // Follow-up email relay (lib/followup/*, app/api/email/inbound). The
  // domain MX'd to Resend Inbound, e.g. "followup.synqiq.co", used to mint
  // conversation aliases and to format outbound Message-IDs for threading.
  | "FOLLOWUP_RELAY_DOMAIN"
  // Signing secret for the Resend inbound webhook ("whsec_..."), verified
  // Svix-style in app/api/email/inbound.
  | "RESEND_INBOUND_WEBHOOK_SECRET";

export function getEnv(key: EnvKey): string {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

export function getOptionalEnv(key: EnvKey): string | undefined {
  return process.env[key];
}
