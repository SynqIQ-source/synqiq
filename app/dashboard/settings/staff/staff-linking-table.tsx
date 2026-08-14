"use client";

import { useState } from "react";

export type StaffLinkingRow = {
  id: string;
  display_name: string;
  role: string;
  email: string | null;
  mindbody_staff_id: number | null;
  auth_user_id: string | null;
  active: boolean;
};

type RowState = {
  email: string;
  status: "idle" | "sending" | "success" | "error";
  message?: string;
  role: string;
  roleStatus: "idle" | "saving" | "error";
  roleError?: string;
};

export function StaffLinkingTable({ staff }: { staff: StaffLinkingRow[] }) {
  const [rowState, setRowState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      staff.map((row) => [
        row.id,
        { email: row.email ?? "", status: "idle" as const, role: row.role, roleStatus: "idle" as const },
      ]),
    ),
  );

  function updateEmail(staffId: string, email: string) {
    setRowState((prev) => ({ ...prev, [staffId]: { ...prev[staffId], email } }));
  }

  async function updateRole(staffId: string, role: string) {
    const previousRole = rowState[staffId]?.role;
    setRowState((prev) => ({
      ...prev,
      [staffId]: { ...prev[staffId], role, roleStatus: "saving", roleError: undefined },
    }));

    try {
      const response = await fetch(`/api/staff/${staffId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        setRowState((prev) => ({
          ...prev,
          [staffId]: {
            ...prev[staffId],
            role: previousRole ?? prev[staffId].role,
            roleStatus: "error",
            roleError: result?.error ?? "Failed to update role.",
          },
        }));
        return;
      }

      setRowState((prev) => ({ ...prev, [staffId]: { ...prev[staffId], roleStatus: "idle" } }));
    } catch (error) {
      setRowState((prev) => ({
        ...prev,
        [staffId]: {
          ...prev[staffId],
          role: previousRole ?? prev[staffId].role,
          roleStatus: "error",
          roleError: error instanceof Error ? error.message : "Failed to update role.",
        },
      }));
    }
  }

  async function sendInvite(row: StaffLinkingRow, confirmRelink: boolean) {
    const email = rowState[row.id]?.email ?? "";

    if (row.auth_user_id && !confirmRelink) {
      const confirmed = window.confirm(
        `${row.display_name} already has a linked login. Sending a new invite will replace it -- continue?`,
      );
      if (!confirmed) return;
      return sendInvite(row, true);
    }

    setRowState((prev) => ({ ...prev, [row.id]: { ...prev[row.id], status: "sending", message: undefined } }));

    try {
      const response = await fetch(`/api/staff/${row.id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, confirmRelink }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        setRowState((prev) => ({
          ...prev,
          [row.id]: { ...prev[row.id], status: "error", message: result.error ?? "Failed to send invite." },
        }));
        return;
      }

      setRowState((prev) => ({
        ...prev,
        [row.id]: { ...prev[row.id], status: "success", message: `Invite sent to ${result.email}.` },
      }));
    } catch (error) {
      setRowState((prev) => ({
        ...prev,
        [row.id]: {
          ...prev[row.id],
          status: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      }));
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
            <th className="p-3 text-left">Name</th>
            <th className="p-3 text-left">Role</th>
            <th className="p-3 text-left">Mindbody</th>
            <th className="p-3 text-left">Login</th>
            <th className="p-3 text-left">Email</th>
            <th className="p-3 text-left">Action</th>
          </tr>
        </thead>
        <tbody>
          {staff.length === 0 ? (
            <tr>
              <td className="p-6 text-center text-sm text-zinc-500" colSpan={6}>
                No staff synced yet.
              </td>
            </tr>
          ) : (
            staff.map((row) => {
              const state = rowState[row.id] ?? {
                email: row.email ?? "",
                status: "idle" as const,
                role: row.role,
                roleStatus: "idle" as const,
              };
              const isLinked = Boolean(row.auth_user_id);

              return (
                <tr key={row.id} className="border-b align-top">
                  <td className="p-3 font-medium text-zinc-950">{row.display_name}</td>
                  <td className="p-3">
                    <select
                      value={state.role}
                      onChange={(event) => updateRole(row.id, event.target.value)}
                      disabled={state.roleStatus === "saving"}
                      className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm capitalize"
                    >
                      <option value="instructor">Instructor</option>
                      <option value="admin">Admin</option>
                    </select>
                    {state.roleStatus === "error" && (
                      <p className="mt-1.5 text-xs text-red-600">{state.roleError}</p>
                    )}
                  </td>
                  <td className="p-3">
                    {row.mindbody_staff_id != null ? (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                        Synq&apos;d
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-400">Software only</span>
                    )}
                  </td>
                  <td className="p-3">
                    {isLinked ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        Linked
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                        Not linked
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <input
                      type="email"
                      value={state.email}
                      onChange={(event) => updateEmail(row.id, event.target.value)}
                      placeholder="staff@email.com"
                      disabled={state.status === "sending"}
                      className="w-56 rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
                    />
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => sendInvite(row, false)}
                      disabled={state.status === "sending" || !state.email}
                      className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                    >
                      {state.status === "sending" ? "Sending..." : isLinked ? "Resend invite" : "Send invite"}
                    </button>
                    {state.status === "success" && (
                      <p className="mt-1.5 text-xs text-emerald-700">{state.message}</p>
                    )}
                    {state.status === "error" && <p className="mt-1.5 text-xs text-red-600">{state.message}</p>}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
