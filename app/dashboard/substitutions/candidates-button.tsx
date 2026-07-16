"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Interest = {
  id: string;
  staffId: string;
  status: "interested" | "declined";
  respondedAt: string;
  displayName: string | null;
  email: string | null;
};

type CandidatesButtonProps = {
  requestId: string;
  className: string;
  startFormatted: string;
  roomName: string;
  requestedByName: string;
};

type FetchStatus = "idle" | "loading" | "loaded" | "error";
type SelectStatus = "idle" | "selecting" | "error";

export function CandidatesButton({
  requestId,
  className,
  startFormatted,
  roomName,
  requestedByName,
}: CandidatesButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [selectStatus, setSelectStatus] = useState<SelectStatus>("idle");
  const [selectError, setSelectError] = useState<string | null>(null);
  const [selectingStaffId, setSelectingStaffId] = useState<string | null>(null);

  async function openModal() {
    setIsOpen(true);
    setSelectStatus("idle");
    setSelectError(null);
    setSelectingStaffId(null);
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

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-teal-700 hover:bg-zinc-50"
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
                  No one has responded yet.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-200">
                  {interests.map((interest) => {
                    const isInterested = interest.status === "interested";

                    return (
                      <li
                        key={interest.id}
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
                            className={
                              isInterested
                                ? "rounded-full bg-teal-50 px-2 py-1 text-xs font-medium text-teal-700"
                                : "rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600"
                            }
                          >
                            {isInterested ? "Interested" : "Declined"}
                          </span>
                          {isInterested ? (
                            <button
                              type="button"
                              onClick={() => handleSelect(interest.staffId)}
                              disabled={selectStatus === "selecting"}
                              className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
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
            </div>

            <div className="mt-5 flex justify-end">
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
