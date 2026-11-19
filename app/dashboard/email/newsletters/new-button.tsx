"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NewNewsletterButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const response = await fetch("/api/email/newsletters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create" }),
        });
        const json = (await response.json().catch(() => ({}))) as { id?: string };
        if (json.id) router.push(`/dashboard/email/newsletters/${json.id}`);
        else setBusy(false);
      }}
    >
      <Plus className="size-4" />
      New newsletter
    </Button>
  );
}
