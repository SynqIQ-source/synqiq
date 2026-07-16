"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type CancelRequestButtonProps = {
  requestId: string;
  callerStaffId: string;
};

type Status = "idle" | "cancelling" | "error";

export function CancelRequestButton({
  requestId,
  callerStaffId,
}: CancelRequestButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleCancel() {
    setStatus("cancelling");
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/substitution-requests/${requestId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callerStaffId }),
      });
      const data = await response.json();

      if (!response.ok) {
        setStatus("error");
        setErrorMessage(data?.error ?? "Failed to cancel this request.");
        return;
      }

      // Cancelled requests drop off "My Requests" (only open/pending/approved
      // show there) -- refresh the server component to reflect that.
      router.refresh();
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to cancel this request.",
      );
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleCancel}
        disabled={status === "cancelling"}
        className="w-full rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
      >
        {status === "cancelling" ? "Cancelling..." : "Cancel Request"}
      </button>
      {status === "error" ? (
        <p className="mt-2 text-sm text-red-600">{errorMessage}</p>
      ) : null}
    </div>
  );
}
