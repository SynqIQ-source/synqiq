import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Member photos: copied from Mindbody's photo URLs into SynqIQ's private
// member-photos bucket (so they survive leaving Mindbody), and shown to
// staff through short-lived signed links. Read-only against Mindbody.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const MEMBER_PHOTO_BUCKET = "member-photos";
const LINK_SECONDS = 3600;
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Only Mindbody's own content hosts, over https (we fetch these server-side).
export function isMindbodyPhotoUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "mindbodyonline.com" || url.hostname.endsWith(".mindbodyonline.com"));
  } catch {
    return false;
  }
}

// Which members need their photo copied: a Mindbody photo we haven't copied,
// or one that changed since the last copy. Pure; exported for tests.
export function photosToCopy(rows: { clientId: string; sourceUrl: string | null; copiedFrom: string | null; path: string | null }[]) {
  return rows.filter((row) => isMindbodyPhotoUrl(row.sourceUrl) && (!row.path || row.copiedFrom !== row.sourceUrl));
}

export async function copyMemberPhotos(organizationId: string, options: { budgetMs?: number; concurrency?: number } = {}) {
  const admin = createSupabaseAdminClient();
  const started = Date.now();
  const budget = options.budgetMs ?? 240_000;
  const rows: { clientId: string; sourceUrl: string | null; copiedFrom: string | null; path: string | null }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin
      .from("member_personal")
      .select("mindbody_client_id, mindbody, photo_path, photo_source_url")
      .eq("organization_id", organizationId)
      .order("mindbody_client_id")
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    for (const row of data ?? [])
      rows.push({
        clientId: row.mindbody_client_id as string,
        sourceUrl: ((row.mindbody as { photoUrl?: string | null } | null)?.photoUrl ?? null) as string | null,
        copiedFrom: (row.photo_source_url as string | null) ?? null,
        path: (row.photo_path as string | null) ?? null,
      });
    if (!data || data.length < 1000) break;
  }
  const queue = photosToCopy(rows);
  let copied = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < queue.length && Date.now() - started < budget) {
      const row = queue[next++];
      try {
        await copyOne(admin, organizationId, row.clientId, row.sourceUrl as string, row.path);
        copied += 1;
      } catch (error) {
        failed += 1;
        console.error("[member-photos]", row.clientId, error instanceof Error ? error.message : error);
      }
    }
  };
  await Promise.all(Array.from({ length: options.concurrency ?? 4 }, worker));
  return { needed: queue.length, copied, failed, left: Math.max(0, queue.length - copied - failed) };
}

async function copyOne(admin: Admin, organizationId: string, clientId: string, sourceUrl: string, oldPath: string | null) {
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(15_000), redirect: "follow" });
  if (!response.ok) throw new Error(`Mindbody returned ${response.status}`);
  if (!isMindbodyPhotoUrl(response.url || sourceUrl)) throw new Error("Redirected off Mindbody");
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const extension = TYPES[type];
  if (!extension) throw new Error(`Not a photo (${type || "no type"})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new Error(`Bad size ${bytes.byteLength}`);
  const path = `${organizationId}/${clientId}-${Date.now()}.${extension}`;
  const { error } = await admin.storage.from(MEMBER_PHOTO_BUCKET).upload(path, bytes, { contentType: type, upsert: false });
  if (error) throw new Error(error.message);
  const { error: saveError } = await admin
    .from("member_personal")
    .update({ photo_path: path, photo_source_url: sourceUrl, photo_copied_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("mindbody_client_id", clientId);
  if (saveError) {
    await admin.storage.from(MEMBER_PHOTO_BUCKET).remove([path]);
    throw new Error(saveError.message);
  }
  if (oldPath && oldPath !== path) await admin.storage.from(MEMBER_PHOTO_BUCKET).remove([oldPath]);
}

// The photo to show staff: SynqIQ's copy (signed link) when there is one,
// else Mindbody's URL.
export async function memberPhotoLink(admin: Admin, path: string | null | undefined, fallback: string | null | undefined) {
  if (path) {
    const { data } = await admin.storage.from(MEMBER_PHOTO_BUCKET).createSignedUrl(path, LINK_SECONDS);
    if (data?.signedUrl) return data.signedUrl;
  }
  return fallback ?? null;
}
