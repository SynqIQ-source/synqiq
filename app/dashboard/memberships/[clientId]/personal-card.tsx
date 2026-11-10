"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PERSONAL_FIELDS, type MemberPersonal, type PersonalField } from "@/lib/memberships/personal";

type Props = {
  clientId: string;
  status: string | null;
  memberSince: string | null;
  personal: MemberPersonal;
  edited: PersonalField[];
  pulledAt: string | null;
  editedNote: string | null; // "Edited Nov 10 by Adam"
};

const longDate = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : null;

const FORM_LAYOUT: { field: PersonalField; span?: 2; type?: string }[] = [
  { field: "firstName" },
  { field: "lastName" },
  { field: "email", span: 2, type: "email" },
  { field: "mobilePhone", type: "tel" },
  { field: "homePhone", type: "tel" },
  { field: "birthDate", type: "date" },
  { field: "addressLine1", span: 2 },
  { field: "addressLine2", span: 2 },
  { field: "city" },
  { field: "state" },
  { field: "postalCode" },
  { field: "emergencyContactName", span: 2 },
  { field: "emergencyContactPhone", type: "tel" },
];

function Item({ label, children, edited }: { label: string; children: React.ReactNode; edited?: boolean }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
        {edited ? <span className="ml-1 normal-case text-amber-700 dark:text-amber-300">· edited</span> : null}
      </dt>
      <dd className="text-sm break-words text-foreground">{children || "—"}</dd>
    </div>
  );
}

export function PersonalCard({ clientId, status, memberSince, personal, edited, pulledAt, editedNote }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<PersonalField, string>>(() => blank(personal));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = `${personal.firstName ?? ""} ${personal.lastName ?? ""}`.trim();
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const address = [
    personal.addressLine1,
    personal.addressLine2,
    [personal.city, personal.state].filter(Boolean).join(", "),
    personal.postalCode,
  ]
    .filter(Boolean)
    .join(", ");
  const isEdited = (...fields: PersonalField[]) => fields.some((field) => edited.includes(field));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/memberships/${encodeURIComponent(clientId)}/personal`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        setError(result.error ?? "Couldn't save. Try again.");
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Personal information</CardTitle>
          <CardDescription className="mt-1">{editedNote ?? (pulledAt ? `From Mindbody, ${pulledAt}` : "From Mindbody")}</CardDescription>
        </div>
        {!editing ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setValues(blank(personal));
              setEditing(true);
            }}
          >
            <Pencil /> Edit
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-4">
          {personal.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Mindbody-hosted photo
            <img src={personal.photoUrl} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">
              {initials}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{name}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {status ? <Badge variant={status === "Active" ? "secondary" : "outline"}>{status}</Badge> : null}
              {memberSince ? <Badge variant="outline">Since {longDate(memberSince)}</Badge> : null}
            </div>
          </div>
        </div>

        {editing ? (
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {FORM_LAYOUT.map(({ field, span, type }) => (
                <div key={field} className={`space-y-1 ${span === 2 ? "col-span-2" : ""}`}>
                  <Label htmlFor={`personal-${field}`} className="text-xs">
                    {PERSONAL_FIELDS[field]}
                  </Label>
                  <Input
                    id={`personal-${field}`}
                    type={type ?? "text"}
                    value={values[field]}
                    maxLength={200}
                    onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Saved in SynqIQ and kept when Mindbody syncs. Mindbody isn&apos;t changed, so update it there too until the switch if needed.
            </p>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
            <Item label="Email" edited={isEdited("email")}>
              {personal.email ? (
                <a href={`mailto:${personal.email}`} className="underline-offset-4 hover:underline">
                  {personal.email}
                </a>
              ) : null}
            </Item>
            <Item label="Mobile" edited={isEdited("mobilePhone")}>
              {personal.mobilePhone ? (
                <a href={`tel:${personal.mobilePhone}`} className="underline-offset-4 hover:underline">
                  {personal.mobilePhone}
                </a>
              ) : null}
            </Item>
            {personal.homePhone ? (
              <Item label="Home phone" edited={isEdited("homePhone")}>
                {personal.homePhone}
              </Item>
            ) : null}
            <Item label="Birthday" edited={isEdited("birthDate")}>
              {longDate(personal.birthDate)}
            </Item>
            <Item label="Address" edited={isEdited("addressLine1", "addressLine2", "city", "state", "postalCode")}>
              {address}
            </Item>
            <Item label="Emergency contact" edited={isEdited("emergencyContactName", "emergencyContactPhone")}>
              {personal.emergencyContactName
                ? `${personal.emergencyContactName}${personal.emergencyContactPhone ? ` · ${personal.emergencyContactPhone}` : ""}`
                : null}
            </Item>
            <Item label="Mindbody client ID">{clientId}</Item>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function blank(personal: MemberPersonal): Record<PersonalField, string> {
  const values = {} as Record<PersonalField, string>;
  for (const field of Object.keys(PERSONAL_FIELDS) as PersonalField[]) values[field] = personal[field] ?? "";
  return values;
}
