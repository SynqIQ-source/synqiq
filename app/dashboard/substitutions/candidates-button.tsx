"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Interest = {
  id: string | null;
  staffId: string;
  status: "interested" | "declined" | "no_response";
  respondedAt: string | null;
  displayName: string | null;
  email: string | null;
};

type CandidatesButtonProps = {
  requestId: string;
  className: string;
  startFormatted: string;
  roomName: string;
  requestedByName: string;
  callerStaffId: string | null;
};

type FetchStatus = "idle" | "loading" | "loaded" | "error";
type SelectStatus = "idle" | "selecting" | "error";
type CancelStatus = "idle" | "cancelling" | "error";

const STATUS_STYLES: Record<Interest["status"], string> = {
  interested: "bg-accent-subtle text-accent",
  no_response: "bg-amber-50 text-amber-700",
  declined: "bg-zinc-100 text-zinc-600",
};

const STATUS_LABELS: Record<Interest["status"], string> = {
  interested: "Interested",
  no_response: "No response yet",
  declined: "Declined",
};

export function CandidatesButton({
  requestId,
  className,
  startFormatted,
  roomName,
  requestedByName,
  callerStaffId,
}: CandidatesButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [selectStatus, setSelectStatus] = useState<SelectStatus>("idle");
  const [selectError, setSelectError] = useState<string | null>(null);
  const [selectingStaffId, setSelectingStaffId] = useState<string | null>(null);
  const [cancelStatus, setCancelStatus] = useState<CancelStatus>("idle");
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function openModal() {
    setIsOpen(true);
    setSelectStatus("idle");
    setSelectError(null);
    setSelectingStaffId(null);
    setCancelStatus("idle");
    setCancelError(null);
    setFetchStatus("loading");
    setFetchError(null);

    try {
      const response = await fetch(`/api/substitution-requests/${requestId}/interest`);
      const data = await response.json();

      if (!response.ok) {
        setFetchStatus("error");
        setFetchError(data?.error ?? "Failed to load candidates.");
        return;
      }

      setInterests(data.interests ?? []);
      setFetchStatus("loaded");
    } catch (error) {
      setFetchStatus("error");
      setFetchError(
        error instanceof Error ? error.message : "Failed to load candidates.",
      );
    }
  }

  function closeModal() {
    setIsOpen(false);
  }

  async function handleSelect(staffId: string) {
    setSelectingStaffId(staffId);
    setSelectStatus("selecting");
    setSelectError(null);

    try {
      const response = await fetch(`/api/substitution-requests/${requestId}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId }),
      });
      const data = await response.json();

      if (!response.ok) {
        setSelectStatus("error");
        // `details` carries MindBody's actual raw error text (see
        // app/api/substitution-requests/[id]/select/route.ts) -- `error` alone
        // is just our generic "MindBody rejected the substitution" wrapper.
        const message = data?.details
          ? `${data?.error ?? "Failed to select this candidate."} (${data.details})`
          : data?.error ?? "Failed to select this candidate.";
        setSelectError(message);
        setSelectingStaffId(null);
        return;
      }

      // The request is now approved, so it drops off the open-requests
      // board -- refresh the server component to reflect that instead of
      // trying to patch the list client-side.
      setIsOpen(false);
      router.refresh();
    } catch (error) {
      setSelectStatus("error");
      setSelectError(
        error instanceof Error ? error.message : "Failed to select this candidate.",
      );
      setSelectingStaffId(null);
    }
  }

  async function handleCancel() {
    if (!callerStaffId) {
      setCancelStatus("error");
      setCancelError("Select your name above first.");
      return;
    }

    setCancelStatus("cancelling");
    setCancelError(null);

    try {
      const response = await fetch(`/api/substitution-requests/${requestId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callerStaffId }),
      });
      const data = await response.json();

      if (!response.ok) {
        setCancelStatus("error");
        setCancelError(data?.error ?? "Failed to cancel this request.");
        return;
      }

      setIsOpen(false);
      router.refresh();
    } catch (error) {
      setCancelStatus("error");
      setCancelError(
        error instanceof Error ? error.message : "Failed to cancel this request.",
      );
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-primary hover:bg-zinc-50"
      >
        View Candidates
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4">
          <div className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-6 shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-zinc-950">
                  Candidates
                </h2>
                <p className="mt-1 text-sm text-zinc-600">
                  {className} &middot; {startFormatted}
                </p>
                <p className="text-sm text-zinc-500">
                  {roomName} &middot; requested by {requestedByName}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
              >
                &times;
              </button>
            </div>

            <div className="mt-5">
              {fetchStatus === "loading" ? (
                <p className="text-sm text-zinc-500">Loading candidates...</p>
              ) : fetchStatus === "error" ? (
                <p className="text-sm text-red-600">{fetchError}</p>
              ) : interests.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No qualified instructors found for this class.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-200">
                  {interests.map((interest) => {
                    const isInterested = interest.status === "interested";

                    return (
                      <li
                        key={interest.staffId}
                        className="flex items-center justify-between gap-4 py-3"
                      >
                        <div>
                          <p className="text-sm font-medium text-zinc-950">
                            {interest.displayName ?? "Unknown staff"}
                          </p>
                          {interest.email ? (
                            <p className="text-xs text-zinc-500">{interest.email}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-3">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[interest.status]}`}
                          >
                            {STATUS_LABELS[interest.status]}
                          </span>
                          {isInterested ? (
                            <button
                              type="button"
                              onClick={() => handleSelect(interest.staffId)}
                              disabled={selectStatus === "selecting"}
                              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                            >
                              {selectStatus === "selecting" &&
                              selectingStaffId === interest.staffId
                                ? "Selecting..."
                                : "Select"}
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {selectStatus === "error" ? (
                <p className="mt-3 text-sm text-red-600">{selectError}</p>
              ) : null}
              {cancelStatus === "error" ? (
                <p className="mt-3 text-sm text-red-600">{cancelError}</p>
              ) : null}
            </div>

            <div className="mt-5 flex justify-between">
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelStatus === "cancelling"}
                className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                {cancelStatus === "cancelling" ? "Cancelling..." : "Cancel Request"}
              </button>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
