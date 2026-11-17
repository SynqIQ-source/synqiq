import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isMindbodyPhotoUrl } from "@/lib/memberships/photos";

// Class photos: Mindbody's class photo (mindbody_image_url, written by the
// catalog sync) is copied into SynqIQ's public class-images bucket and
// image_url points at the copy, so photos keep loading without Mindbody.
// A photo uploaded or removed in SynqIQ (image_source 'synqiq') is never
// replaced. Read-only against Mindbody.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const CLASS_IMAGE_BUCKET = "class-images";
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type ClassImageRow = {
  id: string;
  mindbodyImageUrl: string | null;
  imageUrl: string | null;
  imageSource: string | null;
  copiedFrom: string | null;
};

// Which class types need Mindbody's photo copied: they have one, SynqIQ
// hasn't taken the photo over, and we haven't copied this exact photo yet.
export function classImagesToCopy(rows: ClassImageRow[]) {
  return rows.filter(
    (row) =>
      isMindbodyPhotoUrl(row.mindbodyImageUrl) &&
      row.imageSource !== "synqiq" &&
      (!row.imageUrl || row.copiedFrom !== row.mindbodyImageUrl),
  );
}

// The storage key of a URL in our bucket, if it is one.
export function classImageKey(url: string | null | undefined) {
  const key = url?.split(`/${CLASS_IMAGE_BUCKET}/`)[1];
  return key ? decodeURIComponent(key) : null;
}

export async function copyClassImages(organizationId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("class_types")
    .select("id, mindbody_image_url, image_url, image_source, image_copied_from")
    .eq("organization_id", organizationId);
  if (error) throw new Error(error.message);
  const queue = classImagesToCopy(
    (data ?? []).map((row) => ({
      id: row.id as string,
      mindbodyImageUrl: (row.mindbody_image_url as string | null) ?? null,
      imageUrl: (row.image_url as string | null) ?? null,
      imageSource: (row.image_source as string | null) ?? null,
      copiedFrom: (row.image_copied_from as string | null) ?? null,
    })),
  );
  let copied = 0;
  let failed = 0;
  for (const row of queue) {
    try {
      await copyOne(admin, organizationId, row);
      copied += 1;
    } catch (copyError) {
      failed += 1;
      console.error("[class-images]", row.id, copyError instanceof Error ? copyError.message : copyError);
    }
  }
  return { needed: queue.length, copied, failed };
}

async function copyOne(admin: Admin, organizationId: string, row: ClassImageRow) {
  const sourceUrl = row.mindbodyImageUrl as string;
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(15_000), redirect: "follow" });
  if (!response.ok) throw new Error(`Mindbody returned ${response.status}`);
  if (!isMindbodyPhotoUrl(response.url || sourceUrl)) throw new Error("Redirected off Mindbody");
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const extension = TYPES[type];
  if (!extension) throw new Error(`Not a photo (${type || "no type"})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new Error(`Bad size ${bytes.byteLength}`);
  const key = `${organizationId}/${row.id}-mb-${Date.now()}.${extension}`;
  const { error } = await admin.storage.from(CLASS_IMAGE_BUCKET).upload(key, bytes, { contentType: type, upsert: false });
  if (error) throw new Error(error.message);
  const url = admin.storage.from(CLASS_IMAGE_BUCKET).getPublicUrl(key).data.publicUrl;
  // Only if SynqIQ still hasn't taken the photo over (an upload may have
  // landed meanwhile).
  const { data: saved, error: saveError } = await admin
    .from("class_types")
    .update({ image_url: url, image_source: "mindbody", image_copied_from: sourceUrl })
    .eq("id", row.id)
    .or("image_source.is.null,image_source.eq.mindbody")
    .select("id");
  if (saveError || !saved?.length) {
    await admin.storage.from(CLASS_IMAGE_BUCKET).remove([key]);
    if (saveError) throw new Error(saveError.message);
    return;
  }
  const oldKey = classImageKey(row.imageUrl);
  if (oldKey && oldKey !== key) await admin.storage.from(CLASS_IMAGE_BUCKET).remove([oldKey]);
}
