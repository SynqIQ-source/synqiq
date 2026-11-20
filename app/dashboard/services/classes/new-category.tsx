"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Add a class category (e.g. "HYROX Training Plan") and what it needs.
export function NewCategoryDialog({ items }: { items: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/class-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, itemId }),
      });
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        setError(result.error ?? "Couldn't save. Try again.");
        return;
      }
      setOpen(false);
      setName("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Plus /> Add class category
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add class category</DialogTitle>
          <DialogDescription>
            A group of classes with its own booking rules and pricing, e.g. a workshop series sold as an extra pack.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="category-name">Name</Label>
            <Input
              id="category-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. HYROX Training Plan"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category-needs">Members need</Label>
            <select
              id="category-needs"
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              value={itemId}
              onChange={(event) => setItemId(event.target.value)}
            >
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Pick &quot;Group classes&quot; if memberships cover it. For an extra-fee series, add an item for it on What&apos;s Included
              first and tick it on the pack you sell.
            </p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
