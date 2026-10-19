"use client";

import { useState } from "react";

type SubRequestButtonProps = {
  occurrenceId: string;
  className: string;
  timeFormatted: string;
  roomName: string;
  staffDisplayName: string;
};

type SubmitStatus = "idle" | "submitting" | "success" | "error";

export function SubRequestButton({
  occurrenceId,
  className,
  timeFormatted,
  roomName,
  staffDisplayName,
}: SubRequestButtonProps) {
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
        setErrorMessage(data?.error ?? "Failed to create substitution request.");
        return;
      }

      setStatus("success");
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to create substitution request.",
      );
    }
  }

  if (status === "success") {
    return (
      <span className="inline-flex items-center rounded-md bg-brand-accent-subtle px-3 py-2 text-sm font-medium text-brand-accent">
        Request submitted
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="w-full rounded-md bg-brand-accent px-3 py-2 text-sm font-medium text-white hover:bg-brand-accent-hover"
      >
        Create Sub Request
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-[1px]">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
            <h2 className="text-base font-semibold text-foreground">
              Request a Substitute
            </h2>
            <dl className="mt-4 space-y-1 text-sm text-muted-foreground">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Class</dt>
                <dd className="text-right text-foreground">{className}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Time</dt>
                <dd className="text-right text-foreground">{timeFormatted}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Room</dt>
                <dd className="text-right text-foreground">{roomName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Instructor</dt>
                <dd className="text-right text-foreground">
                  {staffDisplayName}
                </dd>
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
