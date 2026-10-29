"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { IntroStatus } from "@/lib/crm/onboarding";

export type MemberTableRow = {
  id: string;
  name: string;
  enrolled: string;
  enrollmentPending: boolean;
  membership: string | null;
  soldBy: string | null;
  trainerId: string | null;
  assigned: string | null;
  lastContact: string | null;
  contactCount: number;
  unread: number;
  introStatus: IntroStatus;
  introLabel: string;
  introAt: string | null;
};

const INTRO_VARIANT: Record<IntroStatus, "default" | "secondary" | "outline" | "destructive"> = {
  done: "default",
  booked: "secondary",
  none: "outline",
  no_show: "destructive",
  late_cancel: "destructive",
};

async function assign(contactIds: string[], trainerStaffId: string | null) {
  const response = await fetch("/api/crm/trainer-assignments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactIds, trainerStaffId }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) throw new Error(result.error ?? "Something went wrong.");
}

// The member list with per-row and bulk trainer assignment.
export function NewMembersTable({
  rows,
  trainers,
}: {
  rows: MemberTableRow[];
  trainers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTrainer, setBulkTrainer] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(contactIds: string[], trainerStaffId: string | null) {
    setBusy(true);
    setError(null);
    try {
      await assign(contactIds, trainerStaffId);
      setSelected(new Set());
      setBulkTrainer("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card className="py-0">
      <CardHeader className="pt-6">
        <CardTitle>Members</CardTitle>
        <CardDescription>
          Pick a trainer for each member, or tick several and assign them together. The trainer is notified and sees the
          member under Follow Up → New members.
        </CardDescription>
        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <Select value={bulkTrainer} onValueChange={setBulkTrainer}>
              <SelectTrigger aria-label="Assign to" className="min-w-[180px] bg-card">
                <SelectValue placeholder="Assign to…" />
              </SelectTrigger>
              <SelectContent>
                {trainers.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" disabled={!bulkTrainer || busy} onClick={() => void run([...selected], bulkTrainer)}>
              Assign
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardHeader>
      {rows.length === 0 ? (
        <p className="px-6 pb-6 text-sm text-muted-foreground">No new members in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all"
                    checked={allSelected}
                    onCheckedChange={(checked) => setSelected(checked ? new Set(rows.map((row) => row.id)) : new Set())}
                  />
                </TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Enrolled</TableHead>
                <TableHead>Sold by</TableHead>
                <TableHead>Trainer</TableHead>
                <TableHead>Outreach</TableHead>
                <TableHead>Intro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-state={selected.has(row.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${row.name}`}
                      checked={selected.has(row.id)}
                      onCheckedChange={() => toggle(row.id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium whitespace-nowrap">
                    <Link href={`/dashboard/guests/${row.id}`} className="hover:underline">
                      {row.name}
                    </Link>
                    {row.unread > 0 ? (
                      <Badge className="ml-2" variant="default">
                        {row.unread} new
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.enrolled}
                    <span className="block text-xs text-muted-foreground">
                      {row.enrollmentPending ? "Checking contract…" : (row.membership ?? "No contract found")}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{row.soldBy ?? "—"}</TableCell>
                  <TableCell className="min-w-[180px]">
                    <Select
                      value={row.trainerId ?? "none"}
                      disabled={busy}
                      onValueChange={(value) => void run([row.id], value === "none" ? null : value)}
                    >
                      <SelectTrigger aria-label={`Trainer for ${row.name}`} className="h-8 bg-card">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {trainers.map((person) => (
                          <SelectItem key={person.id} value={person.id}>
                            {person.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {row.assigned ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">Assigned {row.assigned}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.contactCount > 0 ? (
                      <>
                        {row.contactCount} contact{row.contactCount === 1 ? "" : "s"}
                        <span className="block text-xs text-muted-foreground">Last {row.lastContact}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">{row.trainerId ? "Not contacted yet" : "—"}</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant={INTRO_VARIANT[row.introStatus]}>{row.introLabel}</Badge>
                    {row.introAt ? <span className="block text-xs text-muted-foreground">{row.introAt}</span> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
