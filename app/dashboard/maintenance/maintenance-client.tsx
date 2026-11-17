"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { MEDIA_LIMITS } from "@/lib/maintenance/rules";

export type EquipmentOption = { id: string; name: string; area: string | null; isCritical: boolean };
export type VendorOption = { id: string; name: string; email: string | null };
export type StaffOption = { id: string; name: string };

const selectClass = "h-9 w-full rounded-md border bg-transparent px-2 text-sm";

async function postJson(url: string, body: unknown, method = "POST") {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown> & { success?: boolean; error?: string };
  if (!response.ok || !result.success) throw new Error(result.error ?? "Something went wrong. Try again.");
  return result;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Message({ text, ok }: { text: string | null; ok?: boolean }) {
  if (!text) return null;
  return <p className={`text-sm ${ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>{text}</p>;
}

// --- Photos and videos ------------------------------------------------------

const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

function fileType(file: File) {
  if (file.type) return file.type.toLowerCase();
  return EXTENSION_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

function videoSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    video.src = url;
  });
}

// Uploads one file: the server checks the limits and hands back a one-time
// upload link; the file goes straight to private storage; then confirmed.
async function uploadMedia(issueId: string, file: File) {
  const contentType = fileType(file);
  const durationSeconds = contentType.startsWith("video/") ? await videoSeconds(file) : null;
  const start = await postJson(`/api/maintenance/issues/${issueId}/media`, { contentType, sizeBytes: file.size, durationSeconds });
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.storage
    .from(start.bucket as string)
    .uploadToSignedUrl(start.path as string, start.token as string, file, { contentType });
  if (error) {
    await fetch(`/api/maintenance/issues/${issueId}/media/${start.mediaId}`, { method: "DELETE" });
    throw new Error(`${file.name}: upload failed. Try again.`);
  }
  await postJson(`/api/maintenance/issues/${issueId}/media/${start.mediaId}`, {}, "PATCH");
}

export function MediaPicker({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <Input
        type="file"
        multiple
        accept="image/*,video/*"
        disabled={disabled}
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      <p className="text-xs text-muted-foreground">
        Up to {MEDIA_LIMITS.photos} photos and {MEDIA_LIMITS.videos} videos (different angles), {MEDIA_LIMITS.videoSecondsTotal} seconds of
        video in total.
      </p>
    </div>
  );
}

async function uploadAll(issueId: string, files: File[], progress: (text: string) => void) {
  const problems: string[] = [];
  for (const [index, file] of files.entries()) {
    progress(`Uploading ${index + 1} of ${files.length}…`);
    try {
      await uploadMedia(issueId, file);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : `${file.name}: upload failed.`);
    }
  }
  return problems;
}

export function AddMediaButton({ issueId }: { issueId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <MediaPicker
        disabled={busy}
        onFiles={async (files) => {
          if (!files.length) return;
          setBusy(true);
          const problems = await uploadAll(issueId, files, (text) => setStatus({ text, ok: true }));
          setBusy(false);
          setStatus(problems.length ? { text: problems.join(" "), ok: false } : { text: "Added.", ok: true });
          router.refresh();
        }}
      />
      <Message text={status?.text ?? null} ok={status?.ok} />
    </div>
  );
}

// --- Report an issue ----------------------------------------------------------

export function ReportIssueDialog({ equipment }: { equipment: EquipmentOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [equipmentId, setEquipmentId] = useState("");
  const [locationText, setLocationText] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const picked = equipment.find((item) => item.id === equipmentId);

  const submit = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const created = await postJson("/api/maintenance/issues", {
        equipmentId: equipmentId || null,
        locationText: equipmentId ? null : locationText,
        title,
        description,
        isCritical: urgent,
      });
      const id = created.id as string;
      const problems = files.length ? await uploadAll(id, files, (text) => setStatus({ text, ok: true })) : [];
      if (problems.length) {
        setStatus({ text: `Reported, but: ${problems.join(" ")} You can add them on the report.`, ok: false });
        setBusy(false);
        return;
      }
      router.push(`/dashboard/maintenance/${id}`);
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : "Couldn't report it.", ok: false });
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Report an issue
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Report a maintenance issue</DialogTitle>
          <DialogDescription>The equipment&apos;s owner and Club Admins are emailed right away.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Equipment">
            <select className={selectClass} value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)}>
              <option value="">Not in the list</option>
              {equipment.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.area ? ` · ${item.area}` : ""}
                  {item.isCritical ? " (critical)" : ""}
                </option>
              ))}
            </select>
          </Field>
          {equipmentId ? (
            picked?.isCritical ? (
              <p className="text-sm font-medium text-destructive">Critical equipment: the owner and Club Admins get an urgent alert.</p>
            ) : null
          ) : (
            <>
              <Field label="Where is it?">
                <Input
                  value={locationText}
                  onChange={(event) => setLocationText(event.target.value)}
                  placeholder="e.g. Women's locker room sink"
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={urgent} onCheckedChange={setUrgent} /> Urgent (safety issue or closes an area)
              </label>
            </>
          )}
          <Field label="What's wrong (short)">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Steam room not heating"
              maxLength={120}
            />
          </Field>
          <Field label="Details">
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              placeholder="What happened, when you noticed it, any error codes, anything already tried."
            />
          </Field>
          <Field label="Photos / video (optional)">
            <MediaPicker disabled={busy} onFiles={(picked) => setFiles([...files, ...picked])} />
            {files.length ? (
              <p className="text-xs">
                {files.length} file{files.length === 1 ? "" : "s"}: {files.map((file) => file.name).join(", ")}{" "}
                <button type="button" className="underline" onClick={() => setFiles([])}>
                  clear
                </button>
              </p>
            ) : null}
          </Field>
          <Message text={status?.text ?? null} ok={status?.ok} />
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !title.trim() || !description.trim() || (!equipmentId && !locationText.trim())} onClick={submit}>
            {busy ? "Sending…" : "Report it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Issue actions --------------------------------------------------------------

export function IssueActions(props: {
  issueId: string;
  status: string;
  canRun: boolean;
  isAdmin: boolean;
  vendors: VendorOption[];
  vendorId: string | null;
  contacted: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [noteKind, setNoteKind] = useState<"note" | "troubleshooting">("troubleshooting");
  const [visitAt, setVisitAt] = useState("");
  const [visitNote, setVisitNote] = useState("");
  const [amount, setAmount] = useState("");
  const [amountKind, setAmountKind] = useState<"quote" | "paid">("quote");
  const [amountNote, setAmountNote] = useState("");
  const [vendorId, setVendorId] = useState(props.vendorId ?? "");
  const [vendorMessage, setVendorMessage] = useState("");
  const resolved = props.status === "resolved";

  const run = async (body: unknown, url = `/api/maintenance/issues/${props.issueId}/events`, done = "Saved.") => {
    setBusy(true);
    setStatus(null);
    try {
      await postJson(url, body);
      setStatus({ text: done, ok: true });
      router.refresh();
      return true;
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : "Couldn't save.", ok: false });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Message text={status?.text ?? null} ok={status?.ok} />

      <section className="space-y-2">
        <div className="flex gap-2 text-sm">
          {(["troubleshooting", "note"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={`rounded-md px-2 py-1 ${noteKind === kind ? "bg-primary text-primary-foreground" : "bg-muted"}`}
              onClick={() => setNoteKind(kind)}
            >
              {kind === "troubleshooting" ? "Troubleshooting step" : "Note"}
            </button>
          ))}
        </div>
        <Textarea
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={noteKind === "troubleshooting" ? "What was tried in house and what happened" : "Add a note"}
        />
        <Button size="sm" disabled={busy || !note.trim()} onClick={async () => (await run({ kind: noteKind, body: note })) && setNote("")}>
          Add {noteKind === "troubleshooting" ? "step" : "note"}
        </Button>
        {noteKind === "troubleshooting" ? (
          <p className="text-xs text-muted-foreground">Troubleshooting steps are included when a Club Admin contacts a vendor.</p>
        ) : null}
      </section>

      {props.isAdmin && !resolved ? (
        <section className="space-y-2 rounded-md border p-3">
          <p className="font-medium">{props.contacted ? "Email the vendor" : "Approve and contact a vendor"}</p>
          <select className={selectClass} value={vendorId} onChange={(event) => setVendorId(event.target.value)}>
            <option value="">Pick a vendor</option>
            {props.vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id} disabled={!vendor.email}>
                {vendor.name}
                {vendor.email ? "" : " (no email on file)"}
              </option>
            ))}
          </select>
          <Textarea
            rows={4}
            value={vendorMessage}
            onChange={(event) => setVendorMessage(event.target.value)}
            placeholder={props.contacted ? "Your reply" : "Hi, we need service on the item below. When can you come out?"}
          />
          {!props.contacted ? (
            <p className="text-xs text-muted-foreground">
              The first email includes the original report, model and serial numbers, the troubleshooting steps and links to the photos and
              video. Replies come back here.
            </p>
          ) : null}
          <Button
            size="sm"
            disabled={busy || !vendorId || !vendorMessage.trim()}
            onClick={async () =>
              (await run(
                { vendorId, message: vendorMessage },
                `/api/maintenance/issues/${props.issueId}/vendor-email`,
                "Sent to the vendor.",
              )) && setVendorMessage("")
            }
          >
            Send email
          </Button>
        </section>
      ) : null}

      {props.canRun && !resolved ? (
        <section className="space-y-2 rounded-md border p-3">
          <p className="font-medium">Vendor visit</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input type="datetime-local" value={visitAt} onChange={(event) => setVisitAt(event.target.value)} />
            <Input value={visitNote} onChange={(event) => setVisitNote(event.target.value)} placeholder="Note (optional), e.g. tech name" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || !visitAt}
              onClick={async () =>
                (await run({ kind: "visit", visitAt, body: visitNote }, undefined, "Visit scheduled.")) && setVisitNote("")
              }
            >
              Schedule visit
            </Button>
            {props.status === "visit_scheduled" ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run({ kind: "on_site" })}>
                Vendor is on site
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {props.isAdmin ? (
        <section className="space-y-2 rounded-md border p-3">
          <p className="font-medium">Quote or payment</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <select className={selectClass} value={amountKind} onChange={(event) => setAmountKind(event.target.value as "quote" | "paid")}>
              <option value="quote">Quote</option>
              <option value="paid">Paid</option>
            </select>
            <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="$ amount" />
            <Input value={amountNote} onChange={(event) => setAmountNote(event.target.value)} placeholder="Note (invoice #…)" />
          </div>
          <Button
            size="sm"
            disabled={busy || !amount.trim()}
            onClick={async () => {
              if (await run({ kind: amountKind, amount, body: amountNote })) {
                setAmount("");
                setAmountNote("");
              }
            }}
          >
            Add {amountKind === "quote" ? "quote" : "payment"}
          </Button>
        </section>
      ) : null}

      {props.canRun ? (
        <section className="space-y-2">
          {resolved ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run({ kind: "reopened" }, undefined, "Reopened.")}>
              Reopen
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => run({ kind: "resolved", body: note.trim() || null }, undefined, "Marked resolved.")}
            >
              Mark resolved
            </Button>
          )}
        </section>
      ) : null}
    </div>
  );
}

// --- Equipment and vendors (Club Admins) ------------------------------------------

export type EquipmentForm = {
  id?: string;
  name: string;
  area: string;
  modelNumber: string;
  serialNumber: string;
  isCritical: boolean;
  ownerStaffId: string;
  defaultVendorId: string;
  notes: string;
};

export function EquipmentDialog({
  initial,
  staff,
  vendors,
  trigger,
}: {
  initial?: EquipmentForm;
  staff: StaffOption[];
  vendors: VendorOption[];
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const blank: EquipmentForm = {
    name: "",
    area: "",
    modelNumber: "",
    serialNumber: "",
    isCritical: false,
    ownerStaffId: "",
    defaultVendorId: "",
    notes: "",
  };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<EquipmentForm>(initial ?? blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof EquipmentForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: event.target.value });

  const save = async (extra?: { archived: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      await postJson(
        initial?.id ? `/api/maintenance/equipment/${initial.id}` : "/api/maintenance/equipment",
        extra ?? form,
        initial?.id ? "PATCH" : "POST",
      );
      setOpen(false);
      if (!initial) setForm(blank);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit equipment" : "Add equipment"}</DialogTitle>
          <DialogDescription>Critical equipment sends an urgent alert (email + push) the day it&apos;s reported.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={form.name} onChange={set("name")} placeholder="e.g. Steam room generator" />
          </Field>
          <Field label="Area">
            <Input value={form.area} onChange={set("area")} placeholder="e.g. Men's locker room" />
          </Field>
          <Field label="Model #">
            <Input value={form.modelNumber} onChange={set("modelNumber")} />
          </Field>
          <Field label="Serial #">
            <Input value={form.serialNumber} onChange={set("serialNumber")} />
          </Field>
          <Field label="Owner (gets the alerts)">
            <select className={selectClass} value={form.ownerStaffId} onChange={set("ownerStaffId")}>
              <option value="">Club Admins only</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Usual vendor">
            <select className={selectClass} value={form.defaultVendorId} onChange={set("defaultVendorId")}>
              <option value="">None</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Switch checked={form.isCritical} onCheckedChange={(value) => setForm({ ...form, isCritical: value })} /> Critical (urgent alert
            the day it&apos;s reported)
          </label>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <Textarea rows={2} value={form.notes} onChange={set("notes")} placeholder="Warranty, install date, filter size…" />
            </Field>
          </div>
        </div>
        <Message text={error} />
        <DialogFooter className="gap-2">
          {initial?.id ? (
            <Button variant="ghost" className="mr-auto text-destructive" disabled={busy} onClick={() => save({ archived: true })}>
              Retire
            </Button>
          ) : null}
          <Button disabled={busy || !form.name.trim()} onClick={() => save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type VendorForm = { id?: string; name: string; contactName: string; email: string; phone: string; notes: string };

export function VendorDialog({ initial, trigger }: { initial?: VendorForm; trigger: React.ReactNode }) {
  const router = useRouter();
  const blank: VendorForm = { name: "", contactName: "", email: "", phone: "", notes: "" };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<VendorForm>(initial ?? blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof VendorForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: event.target.value });

  const save = async (extra?: { archived: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      await postJson(
        initial?.id ? `/api/maintenance/vendors/${initial.id}` : "/api/maintenance/vendors",
        extra ?? form,
        initial?.id ? "PATCH" : "POST",
      );
      setOpen(false);
      if (!initial) setForm(blank);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit vendor" : "Add vendor"}</DialogTitle>
          <DialogDescription>Vendors are emailed from the report; their replies come back to it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company">
            <Input value={form.name} onChange={set("name")} />
          </Field>
          <Field label="Contact name">
            <Input value={form.contactName} onChange={set("contactName")} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={set("email")} />
          </Field>
          <Field label="Phone (texting comes later)">
            <Input type="tel" value={form.phone} onChange={set("phone")} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <Textarea rows={2} value={form.notes} onChange={set("notes")} placeholder="Account #, service area, after-hours line…" />
            </Field>
          </div>
        </div>
        <Message text={error} />
        <DialogFooter className="gap-2">
          {initial?.id ? (
            <Button variant="ghost" className="mr-auto text-destructive" disabled={busy} onClick={() => save({ archived: true })}>
              Archive
            </Button>
          ) : null}
          <Button disabled={busy || !form.name.trim()} onClick={() => save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
