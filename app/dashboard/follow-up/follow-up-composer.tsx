"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type FollowUpComposerProps = {
  clientId: string;
  clientName: string;
  conversationId: string | null;
};

type Status = "idle" | "submitting" | "error";

const DEFAULT_SUBJECT = "Checking in";

export function FollowUpComposer({ clientId, clientName, conversationId }: FollowUpComposerProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Already has a thread -> the row just links straight to it.
  if (conversationId) {
    return (
      <Link
        href={`/dashboard/follow-up/${conversationId}`}
        className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
      >
        View conversation
      </Link>
    );
  }

  function openModal() {
    setSubject(DEFAULT_SUBJECT);
    setMessage("");
    setStatus("idle");
    setErrorMessage(null);
    setIsOpen(true);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          subject: subject.trim() || DEFAULT_SUBJECT,
          body: message.trim(),
        }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setStatus("error");
        setErrorMessage(data?.error ?? "Could not send the message.");
        return;
      }

      // Land the instructor in the thread they just started.
      router.push(`/dashboard/follow-up/${data.conversationId}`);
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Could not send the message.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
      >
        Follow Up
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4">
          <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-lg">
            <h2 className="text-base font-semibold text-zinc-950">Message {clientName}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              They&apos;ll see this from &ldquo;you, at the studio&rdquo; and can reply straight back.
              Your email address isn&apos;t shared.
            </p>

            <form onSubmit={handleSubmit} className="mt-4">
              <label className="block text-sm font-medium text-zinc-700">
                Subject
                <input
                  type="text"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-950"
                />
              </label>

              <label className="mt-4 block text-sm font-medium text-zinc-700">
                Message
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={5}
                  required
                  placeholder={`Hi ${clientName.split(" ")[0] || "there"}, great having you in class...`}
                  className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-950"
                />
              </label>

              {status === "error" ? (
                <p className="mt-3 text-sm text-red-600">{errorMessage}</p>
              ) : null}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={status === "submitting" || !message.trim()}
                  className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                >
                  {status === "submitting" ? "Sending..." : "Send"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
