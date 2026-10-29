"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tablet } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NOBODY = "nobody";

// "Who's on the iPad": the salesperson working the front desk on a kiosk.
// Returning guests who check in there are reassigned to them.
export function OnDutySelect({
  devices,
  salespeople,
}: {
  devices: { id: string; name: string; onDutyStaffId: string | null }[];
  salespeople: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(deviceId: string, value: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/crm/kiosk-devices/${deviceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "on_duty", staffId: value === NOBODY ? null : value }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error ?? "Couldn't update.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {devices.map((device) => (
        <Select
          key={device.id}
          value={device.onDutyStaffId ?? NOBODY}
          onValueChange={(value) => void change(device.id, value)}
          disabled={busy}
        >
          <SelectTrigger aria-label={`On duty on ${device.name}`} className="min-w-[200px] bg-card">
            <span className="flex items-center gap-2">
              <Tablet className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{devices.length > 1 ? device.name : "On the iPad"}:</span>
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NOBODY}>Nobody</SelectItem>
            {salespeople.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                {person.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
