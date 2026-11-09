"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ROLE_LABELS, STAFF_ROLES } from "@/lib/permissions";

export type StaffLinkingRow = {
  id: string;
  display_name: string;
  role: string;
  can_sell: boolean;
  is_instructor: boolean;
  is_trainer: boolean;
  email: string | null;
  mindbody_staff_id: number | null;
  auth_user_id: string | null;
  active: boolean;
  archived_at: string | null;
};

type RowState = {
  email: string;
  status: "idle" | "sending" | "success" | "error";
  message?: string;
  // Set while the destructive "Re-invite" action is waiting for an inline
  // confirm. Not a window.confirm() -- those can be silently suppressed by
  // the browser after a prior dialog ("prevent this page from creating
  // additional dialogs"), which left admins with a re-invite that just
  // did nothing and no way through.
  confirmingRelink: boolean;
  // Same inline-confirm treatment for the two lifecycle actions.
  confirmingArchive: boolean;
  confirmingDelete: boolean;
  lifecycleStatus: "idle" | "working" | "error";
  lifecycleError?: string;
  access: Access;
  roleStatus: "idle" | "saving" | "error";
  roleError?: string;
};

// What a club admin sets per person (see lib/permissions.ts).
type Access = { role: string; canSell: boolean; isInstructor: boolean; isTrainer: boolean };

const ROLE_HELP: Record<string, string> = {
  admin: "Everything in the studio: settings, staff and roles, sub approvals, every dashboard.",
  sales_lead: "Every guest and lead, reassigning, marking sold, every salesperson's numbers.",
  sales: "Only the guests and leads assigned to them, and their own numbers.",
  staff: "No management or sales access. Add Instructor or Trainer below.",
};

function initialRowState(row: StaffLinkingRow): RowState {
  return {
    email: row.email ?? "",
    status: "idle",
    confirmingRelink: false,
    confirmingArchive: false,
    confirmingDelete: false,
    lifecycleStatus: "idle",
    access: { role: row.role, canSell: row.can_sell, isInstructor: row.is_instructor, isTrainer: row.is_trainer },
    roleStatus: "idle",
  };
}

const EMPTY_ROW_STATE: RowState = {
  email: "",
  status: "idle",
  confirmingRelink: false,
  confirmingArchive: false,
  confirmingDelete: false,
  lifecycleStatus: "idle",
  access: { role: "staff", canSell: false, isInstructor: false, isTrainer: false },
  roleStatus: "idle",
};

export function StaffLinkingTable({ staff }: { staff: StaffLinkingRow[] }) {
  const router = useRouter();
  const [rowState, setRowState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(staff.map((row) => [row.id, initialRowState(row)])),
  );

  const { activeStaff, archivedStaff } = useMemo(() => {
    const activeStaff: StaffLinkingRow[] = [];
    const archivedStaff: StaffLinkingRow[] = [];
    for (const row of staff) {
      (row.archived_at ? archivedStaff : activeStaff).push(row);
    }
    return { activeStaff, archivedStaff };
  }, [staff]);

  function patchRow(staffId: string, patch: Partial<RowState>) {
    setRowState((prev) => ({
      ...prev,
      [staffId]: { ...(prev[staffId] ?? EMPTY_ROW_STATE), ...patch },
    }));
  }

  function updateEmail(staffId: string, email: string) {
    patchRow(staffId, { email });
  }

  // Saves one change (role, selling, or a tag). The screen updates right
  // away and rolls back if the server refuses; the server's answer wins,
  // since a role change can switch selling on or off with it.
  async function updateAccess(
    staffId: string,
    patch: Partial<{ role: string; canSell: boolean; isInstructor: boolean; isTrainer: boolean }>,
  ) {
    const previous = (rowState[staffId] ?? EMPTY_ROW_STATE).access;
    patchRow(staffId, { access: { ...previous, ...patch }, roleStatus: "saving", roleError: undefined });

    try {
      const response = await fetch(`/api/staff/${staffId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        patchRow(staffId, {
          access: previous,
          roleStatus: "error",
          roleError: result?.error ?? "Failed to update access.",
        });
        return;
      }

      patchRow(staffId, {
        access: {
          role: result.role,
          canSell: result.canSell,
          isInstructor: result.isInstructor,
          isTrainer: result.isTrainer,
        },
        roleStatus: "idle",
      });
    } catch (error) {
      patchRow(staffId, {
        access: previous,
        roleStatus: "error",
        roleError: error instanceof Error ? error.message : "Failed to update access.",
      });
    }
  }

  // Existing account: change the linked login's email if the field differs,
  // then send a Supabase password-reset email. Never creates a new auth
  // user -- see app/api/staff/[id]/reset-password/route.ts.
  async function sendReset(row: StaffLinkingRow) {
    const email = rowState[row.id]?.email ?? "";
    patchRow(row.id, { status: "sending", message: undefined, confirmingRelink: false });

    try {
      const response = await fetch(`/api/staff/${row.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        patchRow(row.id, { status: "error", message: result.error ?? "Failed to send reset." });
        return;
      }

      patchRow(row.id, {
        status: "success",
        message: result.emailChanged
          ? `Login email set to ${result.email} and a reset link sent.`
          : `Password reset sent to ${result.email}.`,
      });
    } catch (error) {
      patchRow(row.id, {
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // First-time link for a staff member with no login yet, or -- behind the
  // inline confirm -- a deliberate re-invite that REPLACES an existing
  // login with a brand-new account.
  async function sendInvite(row: StaffLinkingRow, confirmRelink: boolean) {
    const email = rowState[row.id]?.email ?? "";
    patchRow(row.id, { status: "sending", message: undefined, confirmingRelink: false });

    try {
      const response = await fetch(`/api/staff/${row.id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, confirmRelink }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        patchRow(row.id, { status: "error", message: result.error ?? "Failed to send invite." });
        return;
      }

      patchRow(row.id, { status: "success", message: `Invite sent to ${result.email}.` });
    } catch (error) {
      patchRow(row.id, {
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async function setArchived(row: StaffLinkingRow, archived: boolean) {
    patchRow(row.id, {
      lifecycleStatus: "working",
      lifecycleError: undefined,
      confirmingArchive: false,
      confirmingDelete: false,
    });

    try {
      const response = await fetch(`/api/staff/${row.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        patchRow(row.id, {
          lifecycleStatus: "error",
          lifecycleError: result?.error ?? "Action failed.",
        });
        return;
      }

      patchRow(row.id, { lifecycleStatus: "idle" });
      router.refresh();
    } catch (error) {
      patchRow(row.id, {
        lifecycleStatus: "error",
        lifecycleError: error instanceof Error ? error.message : "Action failed.",
      });
    }
  }

  async function deleteRow(row: StaffLinkingRow) {
    patchRow(row.id, {
      lifecycleStatus: "working",
      lifecycleError: undefined,
      confirmingArchive: false,
      confirmingDelete: false,
    });

    try {
      const response = await fetch(`/api/staff/${row.id}`, { method: "DELETE" });
      const result = await response.json();

      if (!response.ok || !result.success) {
        patchRow(row.id, {
          lifecycleStatus: "error",
          lifecycleError: result?.error ?? "Delete failed.",
        });
        return;
      }

      router.refresh();
    } catch (error) {
      patchRow(row.id, {
        lifecycleStatus: "error",
        lifecycleError: error instanceof Error ? error.message : "Delete failed.",
      });
    }
  }

  function renderActionCell(row: StaffLinkingRow, state: RowState, busy: boolean) {
    const isLinked = Boolean(row.auth_user_id);
    return (
      <div className="flex flex-col items-start gap-1.5">
        {isLinked ? (
          <>
            <button
              type="button"
              onClick={() => sendReset(row)}
              disabled={busy || !state.email}
              className="rounded-md bg-brand-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-accent-hover disabled:opacity-60"
            >
              {state.status === "sending" ? "Working..." : "Send password reset"}
            </button>
            {state.confirmingRelink ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Replace their login with a new account?</span>
                <button
                  type="button"
                  onClick={() => sendInvite(row, true)}
                  disabled={busy}
                  className="font-medium text-red-600 hover:underline disabled:opacity-60"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => patchRow(row.id, { confirmingRelink: false })}
                  className="text-muted-foreground hover:underline"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => patchRow(row.id, { confirmingRelink: true, message: undefined })}
                disabled={busy}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-60"
              >
                Re-invite instead
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => sendInvite(row, false)}
            disabled={busy || !state.email}
            className="rounded-md bg-brand-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-accent-hover disabled:opacity-60"
          >
            {state.status === "sending" ? "Sending..." : "Send invite"}
          </button>
        )}
        {state.status === "success" && (
          <p className="mt-1.5 text-xs text-emerald-700">{state.message}</p>
        )}
        {state.status === "error" && <p className="mt-1.5 text-xs text-red-600">{state.message}</p>}
      </div>
    );
  }

  function renderLifecycleCell(row: StaffLinkingRow, state: RowState) {
    const busy = state.lifecycleStatus === "working";

    if (row.archived_at) {
      return (
        <div className="flex flex-col items-start gap-1.5">
          <button
            type="button"
            onClick={() => setArchived(row, false)}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-60"
          >
            {busy ? "Working..." : "Restore"}
          </button>
          {state.confirmingDelete ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Permanently delete?</span>
              <button
                type="button"
                onClick={() => deleteRow(row)}
                disabled={busy}
                className="font-medium text-red-600 hover:underline disabled:opacity-60"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => patchRow(row.id, { confirmingDelete: false })}
                className="text-muted-foreground hover:underline"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => patchRow(row.id, { confirmingDelete: true, lifecycleError: undefined })}
              disabled={busy}
              className="text-xs text-red-600 hover:underline disabled:opacity-60"
            >
              Delete permanently
            </button>
          )}
          {state.lifecycleStatus === "error" && (
            <p className="mt-1 text-xs text-red-600">{state.lifecycleError}</p>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col items-start gap-1.5">
        {state.confirmingArchive ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Archive &amp; revoke login?</span>
            <button
              type="button"
              onClick={() => setArchived(row, true)}
              disabled={busy}
              className="font-medium text-amber-700 hover:underline disabled:opacity-60"
            >
              Archive
            </button>
            <button
              type="button"
              onClick={() => patchRow(row.id, { confirmingArchive: false })}
              className="text-muted-foreground hover:underline"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => patchRow(row.id, { confirmingArchive: true, lifecycleError: undefined })}
            disabled={busy}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-60"
          >
            Archive
          </button>
        )}

        {state.confirmingDelete ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Not on staff -- delete for good?</span>
            <button
              type="button"
              onClick={() => deleteRow(row)}
              disabled={busy}
              className="font-medium text-red-600 hover:underline disabled:opacity-60"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => patchRow(row.id, { confirmingDelete: false })}
              className="text-muted-foreground hover:underline"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => patchRow(row.id, { confirmingDelete: true, lifecycleError: undefined })}
            disabled={busy}
            className="text-xs text-red-600 hover:underline disabled:opacity-60"
          >
            Delete permanently
          </button>
        )}

        {busy && <p className="mt-1 text-xs text-muted-foreground">Working...</p>}
        {state.lifecycleStatus === "error" && (
          <p className="mt-1 text-xs text-red-600">{state.lifecycleError}</p>
        )}
      </div>
    );
  }

  function renderRow(row: StaffLinkingRow) {
    const state = rowState[row.id] ?? initialRowState(row);
    const busy = state.status === "sending" || state.lifecycleStatus === "working";

    return (
      <tr key={row.id} className="border-b align-top">
        <td className="p-3 font-medium text-foreground">
          {row.display_name}
          {/* Mindbody's own EmploymentEnd-derived flag -- a quick signal for
              which non-archived rows are actually separated/inactive and
              worth archiving, not a status this page otherwise acts on. */}
          {!row.active && !row.archived_at && (
            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
              Inactive in Mindbody
            </span>
          )}
        </td>
        <td className="p-3">
          <select
            value={state.access.role}
            onChange={(event) => updateAccess(row.id, { role: event.target.value })}
            disabled={state.roleStatus === "saving" || Boolean(row.archived_at)}
            aria-label={`Role for ${row.display_name}`}
            title={ROLE_HELP[state.access.role]}
            className="rounded-md border border-border px-2 py-1.5 text-sm"
          >
            {STAFF_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          <div className="mt-2 flex flex-col gap-1 text-xs text-foreground">
            {(
              [
                ["isInstructor", "Instructor"],
                ["isTrainer", "Trainer"],
                ["canSell", "Sells"],
              ] as const
            ).map(([key, label]) => {
              // Sales always sell; Staff who should sell are made Sales.
              const locked = key === "canSell" && (state.access.role === "sales" || state.access.role === "staff");
              return (
                <label key={key} className="flex items-center gap-1.5" title={locked ? "Set by the role" : undefined}>
                  <input
                    type="checkbox"
                    checked={state.access[key]}
                    onChange={(event) => updateAccess(row.id, { [key]: event.target.checked })}
                    disabled={locked || state.roleStatus === "saving" || Boolean(row.archived_at)}
                  />
                  <span className={locked ? "text-muted-foreground" : undefined}>{label}</span>
                </label>
              );
            })}
          </div>
          {state.roleStatus === "error" && (
            <p className="mt-1.5 max-w-48 text-xs text-red-600">{state.roleError}</p>
          )}
        </td>
        <td className="p-3">
          {row.mindbody_staff_id != null ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
              Synced
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Software only</span>
          )}
        </td>
        <td className="p-3">
          {row.auth_user_id ? (
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
            disabled={busy || Boolean(row.archived_at)}
            className="w-56 rounded-md border border-border px-2 py-1.5 text-sm disabled:bg-muted/50"
          />
        </td>
        <td className="p-3">{row.archived_at ? <span className="text-xs text-muted-foreground">Archived</span> : renderActionCell(row, state, busy)}</td>
        <td className="p-3">{renderLifecycleCell(row, state)}</td>
      </tr>
    );
  }

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-left">Role &amp; access</th>
              <th className="p-3 text-left">Mindbody</th>
              <th className="p-3 text-left">Login</th>
              <th className="p-3 text-left">Email</th>
              <th className="p-3 text-left">Action</th>
              <th className="p-3 text-left">Manage</th>
            </tr>
          </thead>
          <tbody>
            {activeStaff.length === 0 ? (
              <tr>
                <td className="p-6 text-center text-sm text-muted-foreground" colSpan={7}>
                  No staff synced yet.
                </td>
              </tr>
            ) : (
              activeStaff.map(renderRow)
            )}
          </tbody>
        </table>
      </div>

      {archivedStaff.length > 0 && (
        <details className="rounded-lg border">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">
            Archived ({archivedStaff.length})
          </summary>
          <div className="overflow-x-auto border-t">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="p-3 text-left">Name</th>
                  <th className="p-3 text-left">Role &amp; access</th>
                  <th className="p-3 text-left">Mindbody</th>
                  <th className="p-3 text-left">Login</th>
                  <th className="p-3 text-left">Email</th>
                  <th className="p-3 text-left">Action</th>
                  <th className="p-3 text-left">Manage</th>
                </tr>
              </thead>
              <tbody>{archivedStaff.map(renderRow)}</tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
