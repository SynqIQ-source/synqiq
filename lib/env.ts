type EnvKey =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "MINDBODY_API_BASE_URL"
  | "MINDBODY_API_KEY"
  | "MINDBODY_SITE_ID"
  | "MINDBODY_USERNAME"
  | "MINDBODY_PASSWORD";

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
