"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

// A studio's Mindbody connection controls on the Studios page.
export function MindbodyActions({
  studioId,
  studioName,
  connected,
  link: initialLink,
}: {
  studioId: string;
  studioName: string;
  connected: boolean;
  link: string | null;
}) {
  const router = useRouter();
  const [link, setLink] = useState(initialLink);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  async function run(action: "link" | "check" | "connect" | "disconnect") {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/platform/studios/${studioId}/mindbody`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error ?? "Something went wrong.");
      if (action === "link") setLink(result.link);
      if (action === "check") {
        setMessage(
          result.status.approved
            ? `Approved in Mindbody${result.status.siteName ? ` as "${result.status.siteName}"` : ""}.`
            : "Not approved yet. Send the owner the approval link.",
        );
      }
      if (action === "connect") setMessage("Syncing starts with tonight's run.");
      if (action === "disconnect") setMessage("Syncing stopped. Existing data is kept.");
      setConfirmStop(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-1.5">
        {!connected ? (
          <>
            <Button size="xs" variant="outline" disabled={busy} onClick={() => void run("link")}>
              {link ? "New approval link" : "Get approval link"}
            </Button>
            <Button size="xs" variant="outline" disabled={busy} onClick={() => void run("check")}>
              Check approval
            </Button>
            <Button size="xs" disabled={busy} onClick={() => void run("connect")}>
              Start syncing
            </Button>
          </>
        ) : confirmStop ? (
          <>
            <Button size="xs" variant="destructive" disabled={busy} onClick={() => void run("disconnect")}>
              Stop syncing {studioName}
            </Button>
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => setConfirmStop(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => setConfirmStop(true)}>
            Stop syncing
          </Button>
        )}
      </div>
      {link && !connected ? (
        <button
          type="button"
          className="inline-flex max-w-72 items-center gap-1 truncate text-xs text-primary hover:underline"
          title={link}
          onClick={() => {
            void navigator.clipboard.writeText(link).then(() => setMessage("Approval link copied."));
          }}
        >
          <Copy className="h-3 w-3 shrink-0" /> Copy approval link
        </button>
      ) : null}
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      {error ? <p className="max-w-72 text-right text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
