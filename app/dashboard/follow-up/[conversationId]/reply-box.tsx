"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Status = "idle" | "submitting" | "error";

export function ReplyBox({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, body: message.trim() }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setStatus("error");
        setErrorMessage(data?.error ?? "Could not send the reply.");
        return;
      }

      setMessage("");
      setStatus("idle");
      router.refresh();
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Could not send the reply.");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label className="block text-sm font-medium text-zinc-700">
        Reply
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={3}
          required
          className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-950"
        />
      </label>

      {status === "error" ? <p className="mt-2 text-sm text-red-600">{errorMessage}</p> : null}

      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          disabled={status === "submitting" || !message.trim()}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {status === "submitting" ? "Sending..." : "Send reply"}
        </button>
      </div>
    </form>
  );
}
