"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImageIcon, Loader2, Trash2 } from "lucide-react";

export const PHOTO_TYPES = "image/png,image/jpeg,image/webp";

// Uploads a checkout/inventory item's picture (Club Admin; public pos-images
// bucket). Returns the new URL, or an error to show.
export async function uploadItemPhoto(
  itemId: string,
  file: File,
): Promise<{ url: string | null; error: string | null }> {
  const form = new FormData();
  form.append("image", file);
  try {
    const response = await fetch(`/api/pos/items/${itemId}/image`, {
      method: "POST",
      body: form,
    });
    const result = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      imageUrl?: string;
    };
    if (!response.ok || !result.success)
      return {
        url: null,
        error: result.error ?? "Couldn't upload. Try again.",
      };
    return { url: result.imageUrl ?? null, error: null };
  } catch {
    return { url: null, error: "Couldn't reach SynqIQ. Try again." };
  }
}

// A small square picture on a list row: click to add or replace it.
export function ItemPhotoButton({
  itemId,
  imageUrl,
  name,
}: {
  itemId: string;
  imageUrl: string | null;
  name: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(imageUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = url
    ? `Replace the picture of ${name}`
    : `Add a picture of ${name}`;

  async function pick(file: File) {
    setBusy(true);
    setError(null);
    const result = await uploadItemPhoto(itemId, file);
    setBusy(false);
    if (result.error) return setError(result.error);
    setUrl(result.url);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={() => input.current?.click()}
        disabled={busy}
        className="flex size-11 items-center justify-center overflow-hidden rounded-md border bg-muted hover:ring-2 hover:ring-primary/40"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <ImageIcon className="size-4 text-muted-foreground" />
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept={PHOTO_TYPES}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) pick(file);
        }}
      />
      {error ? (
        <span className="max-w-40 text-xs text-destructive">{error}</span>
      ) : null}
    </div>
  );
}

// Category tile corner: add, replace or remove the category's own picture
// (without one, the tile shows its first item's picture or first letter).
export function CategoryPhotoButton({ categoryId, hasOwn, name }: { categoryId: string; hasOwn: boolean; name: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "POST" | "DELETE", file?: File) {
    setBusy(true);
    setError(null);
    let body: FormData | undefined;
    if (file) {
      body = new FormData();
      body.append("image", file);
    }
    try {
      const response = await fetch(`/api/pos/categories/${categoryId}/image`, { method, body });
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) setError(result.error ?? "Couldn't save. Try again.");
      else router.refresh();
    } catch {
      setError("Couldn't reach SynqIQ. Try again.");
    }
    setBusy(false);
  }

  return (
    <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
      <div className="flex gap-1">
        {hasOwn ? (
          <button
            type="button"
            title={`Remove the ${name} picture`}
            aria-label={`Remove the ${name} picture`}
            disabled={busy}
            onClick={() => send("DELETE")}
            className="rounded-md bg-background/90 p-1.5 text-muted-foreground shadow-sm hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </button>
        ) : null}
        <button
          type="button"
          title={hasOwn ? `Replace the ${name} picture` : `Add a picture for ${name}`}
          aria-label={hasOwn ? `Replace the ${name} picture` : `Add a picture for ${name}`}
          disabled={busy}
          onClick={() => input.current?.click()}
          className="rounded-md bg-background/90 p-1.5 text-muted-foreground shadow-sm hover:text-primary"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept={PHOTO_TYPES}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) send("POST", file);
        }}
      />
      {error ? <span className="max-w-40 rounded bg-background/90 px-1 text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
