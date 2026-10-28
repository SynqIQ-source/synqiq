import type { ScopedSupabaseClient } from "@/lib/supabase/scoped";

const PHOTO_URL_SECONDS = 600;

// Short-lived signed URLs for guest photos in the private bucket, created
// with the staff member's own session so storage RLS decides access.
export async function signedPhotoUrls(
  supabase: ScopedSupabaseClient,
  paths: (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  const urls = new Map<string, string>();
  if (unique.length === 0) return urls;
  const { data } = await supabase.storage.from("crm-private").createSignedUrls(unique, PHOTO_URL_SECONDS);
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return urls;
}
