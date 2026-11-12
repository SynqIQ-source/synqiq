"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// The class's photo next to its description: add, replace or remove. Shown
// to members in the booking app and on the website schedule.
export function ClassPhoto({ id, name, imageUrl }: { id: string; name: string; imageUrl: string | null }) {
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
      body.set("image", file);
    }
    try {
      const response = await fetch(`/api/class-types/${id}/image`, { method, body });
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) setError(result.error ?? "Couldn't save. Try again.");
      else router.refresh();
    } catch {
      setError("Couldn't reach SynqIQ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-28 shrink-0 space-y-1">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={imageUrl ? `Change the photo for ${name}` : `Add a photo for ${name}`}
        className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground hover:border-primary"
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin" />
        ) : imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- uploaded class photo
          <img src={imageUrl} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-xs">
            <ImagePlus className="size-5" /> Add photo
          </span>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void send("POST", file);
        }}
      />
      {imageUrl ? (
        <Button size="sm" variant="ghost" className="h-6 w-full px-1 text-xs" disabled={busy} onClick={() => send("DELETE")}>
          Remove
        </Button>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
