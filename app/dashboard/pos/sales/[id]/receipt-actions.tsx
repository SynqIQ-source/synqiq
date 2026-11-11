"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function PrintButton() {
  return (
    <Button size="sm" variant="outline" onClick={() => window.print()}>
      <Printer /> Print
    </Button>
  );
}

export function VoidSale({ saleId }: { saleId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <div className="text-center print:hidden">
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          Void this sale
        </Button>
      </div>
    );
  }
  return (
    <Card className="print:hidden">
      <CardContent className="space-y-2 pt-4">
        <p className="text-sm">Voiding keeps the sale on record, marked void, and leaves it out of the day&apos;s totals.</p>
        <Input placeholder="Reason (e.g. rang up the wrong item)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="destructive"
            disabled={busy || !reason.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const response = await fetch("/api/pos/sales", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "void", saleId, reason }),
              });
              const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
              setBusy(false);
              if (!response.ok || !result.success) return setError(result.error ?? "Couldn't void. Try again.");
              router.refresh();
            }}
          >
            Void sale
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {error ? <span className="text-sm text-destructive">{error}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}
