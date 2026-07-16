"use client";

import { useState } from "react";

export type ResponseStatus = "interested" | "declined" | null;

type ResponseButtonsProps = {
  requestId: string;
  staffId: string;
  initialStatus: ResponseStatus;
};

type ActionState = "idle" | "submitting" | "error";

export function ResponseButtons({
  requestId,
  staffId,
  initialStatus,
}: ResponseButtonsProps) {
  const [status, setStatus] = useState<ResponseStatus>(initialStatus);
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function respond(action: "interest" | "decline") {
    setActionState("submitting");
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/substitution-requests/${requestId}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId }),
        },
      );
      const data = await response.json();

      if (!response.ok) {
        setActionState("error");
        setErrorMessage(data?.error ?? "Failed to submit your response.");
        return;
      }

      setStatus(action === "interest" ? "interested" : "declined");
      setActionState("idle");
    } catch (error) {
      setActionState("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to submit your response.",
      );
    }
  }

  if (status === "interested") {
    return (
      <span className="inline-flex items-center rounded-md bg-teal-50 px-3 py-2 text-sm font-medium text-teal-700">
        You&apos;re interested
      </span>
    );
  }

  if (status === "declined") {
    return (
      <span className="inline-flex items-center rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-600">
        You declined
      </span>
    );
  }

  return (
    <div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => respond("interest")}
          disabled={actionState === "submitting"}
          className="flex-1 rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
        >
          Interested
        </button>
        <button
          type="button"
          onClick={() => respond("decline")}
          disabled={actionState === "submitting"}
          className="flex-1 rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
        >
          Decline
        </button>
      </div>
      {actionState === "error" ? (
        <p className="mt-2 text-sm text-red-600">{errorMessage}</p>
      ) : null}
    </div>
  );
}
