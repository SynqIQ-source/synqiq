"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listPrice, MODULES, type ModuleKey } from "@/lib/plans";

// A studio's modules and price on the Studios page.
export function PlanEditor({
  studioId,
  modules: initialModules,
  customPrice: initialCustom,
}: {
  studioId: string;
  modules: ModuleKey[];
  customPrice: number | null;
}) {
  const router = useRouter();
  const [modules, setModules] = useState<ModuleKey[]>(initialModules);
  const [custom, setCustom] = useState(initialCustom === null ? "" : String(initialCustom));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changed =
    [...modules].sort().join() !== [...initialModules].sort().join() ||
    custom.trim() !== (initialCustom === null ? "" : String(initialCustom));
  const list = listPrice(modules);

  function toggle(key: ModuleKey, on: boolean) {
    setModules((current) => (on ? [...current, key] : current.filter((module) => module !== key)));
    setMessage(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/platform/studios/${studioId}/plan`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules, customPrice: custom.trim() === "" ? null : Number(custom) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error ?? "Couldn't save the plan.");
      setMessage("Saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the plan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {MODULES.map((module) => (
          <label key={module.key} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={modules.includes(module.key)}
              onChange={(event) => toggle(module.key, event.target.checked)}
            />
            {module.name}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">List ${list}/mo · Custom</span>
        <Input
          aria-label="Custom monthly price"
          inputMode="decimal"
          placeholder="none"
          value={custom}
          onChange={(event) => {
            setCustom(event.target.value);
            setMessage(null);
          }}
          className="h-7 w-20"
        />
        {changed ? (
          <Button size="xs" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save plan"}
          </Button>
        ) : null}
        {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
      </div>
      {modules.length === 0 ? <p className="text-xs text-destructive">No modules: staff will only see Overview and settings.</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
