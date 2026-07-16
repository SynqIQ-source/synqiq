"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RequestNewSubButtonProps = {
  occurrenceId: string;
  className: string;
  startFormatted: string;
  roomName: string;
  requestedBy: string | null;
};

type SubmitStatus = "idle" | "submitting" | "error";

export function RequestNewSubButton({
  occurrenceId,
  className,
  startFormatted,
  roomName,
  requestedBy,
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

    if (!requestedBy) {
      setStatus("error");
      setErrorMessage("Select your name above first.");
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/substitution-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          occurrenceId,
          requestedBy,
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
        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-teal-700 hover:bg-zinc-50"
      >
        Request New Sub
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4">
          <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-lg">
            <h2 className="text-base font-semibold text-zinc-950">
              Request a New Substitute
            </h2>
            <p className="mt-2 text-sm text-zinc-600">
              The previously approved substitute can no longer cover this
              class. This closes out that approval and opens a fresh request.
            </p>
            <dl className="mt-4 space-y-1 text-sm text-zinc-600">
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Class</dt>
                <dd className="text-right text-zinc-950">{className}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Time</dt>
                <dd className="text-right text-zinc-950">{startFormatted}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Room</dt>
                <dd className="text-right text-zinc-950">{roomName}</dd>
              </div>
            </dl>

            <form onSubmit={handleSubmit} className="mt-5">
              <label className="block text-sm font-medium text-zinc-700">
                Reason{" "}
                <span className="font-normal text-zinc-500">
                  (visible to managers only)
                </span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  placeholder="Optional"
                  className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-950"
                />
              </label>

              {status === "error" ? (
                <p className="mt-3 text-sm text-red-600">{errorMessage}</p>
              ) : null}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={status === "submitting"}
                  className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
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
