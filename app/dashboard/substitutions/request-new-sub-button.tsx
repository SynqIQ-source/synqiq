"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RequestNewSubButtonProps = {
  occurrenceId: string;
  className: string;
  startFormatted: string;
  roomName: string;
};

type SubmitStatus = "idle" | "submitting" | "error";

export function RequestNewSubButton({
  occurrenceId,
  className,
  startFormatted,
  roomName,
}: RequestNewSubButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function openModal() {
    setStatus("idle");
    setErrorMessage(null);
    setIsOpen(true);
  }

  function closeModal() {
    setIsOpen(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/substitution-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          occurrenceId,
          reason: reason.trim() || undefined,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setStatus("error");
        setErrorMessage(data?.error ?? "Failed to request a new substitute.");
        return;
      }

      // The previous approved request is now superseded (cancelled) and
      // this occurrence has a fresh 'open' request -- refresh the board so
      // this row's status/action flips accordingly.
      setIsOpen(false);
      router.refresh();
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to request a new substitute.",
      );
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-brand-secondary hover:bg-accent"
      >
        Request New Sub
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-[1px]">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
            <h2 className="text-base font-semibold text-foreground">
              Request a New Substitute
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The previously approved substitute can no longer cover this
              class. This closes out that approval and opens a fresh request.
            </p>
            <dl className="mt-4 space-y-1 text-sm text-muted-foreground">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Class</dt>
                <dd className="text-right text-foreground">{className}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Time</dt>
                <dd className="text-right text-foreground">{startFormatted}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Room</dt>
                <dd className="text-right text-foreground">{roomName}</dd>
              </div>
            </dl>

            <form onSubmit={handleSubmit} className="mt-5">
              <label className="block text-sm font-medium text-foreground">
                Reason{" "}
                <span className="font-normal text-muted-foreground">
                  (visible to managers only)
                </span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  placeholder="Optional"
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
                />
              </label>

              {status === "error" ? (
                <p className="mt-3 text-sm text-red-600">{errorMessage}</p>
              ) : null}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={status === "submitting"}
                  className="rounded-md bg-brand-accent px-3 py-2 text-sm font-medium text-white hover:bg-brand-accent-hover disabled:opacity-60"
                >
                  {status === "submitting" ? "Submitting..." : "Submit Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
