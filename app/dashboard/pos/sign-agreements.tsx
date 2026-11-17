"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SignaturePad } from "@/components/crm/signature-pad";

export type AgreementToSign = { lineIndex: number; itemName: string; title: string; body: string; sha256: string };
export type SignedAgreement = {
  lineIndex: number;
  sha256: string;
  signerName: string;
  method: "drawn" | "typed";
  signature: string | null;
  agreed: boolean;
};

// Full screen, for handing the iPad / touchscreen to the member: one
// agreement at a time; they read it, type their name, and sign with a finger
// (or type their name and agree). Finishing completes the sale.
export function SignAgreements({
  agreements,
  memberName,
  saving,
  error,
  onCancel,
  onDone,
}: {
  agreements: AgreementToSign[];
  memberName: string;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onDone: (signed: SignedAgreement[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const [signed, setSigned] = useState<SignedAgreement[]>([]);
  const [name, setName] = useState(memberName);
  const [method, setMethod] = useState<"drawn" | "typed">("drawn");
  const [signature, setSignature] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const agreement = agreements[index];
  const last = index === agreements.length - 1;
  const ready = name.trim().length >= 2 && agreed && (method === "typed" || Boolean(signature));

  function next() {
    if (!ready) return;
    const all = [
      ...signed.filter((row) => row.lineIndex !== agreement.lineIndex),
      {
        lineIndex: agreement.lineIndex,
        sha256: agreement.sha256,
        signerName: name.trim(),
        method,
        signature: method === "drawn" ? signature : null,
        agreed,
      },
    ];
    setSigned(all);
    if (last) return onDone(all);
    setIndex(index + 1);
    setSignature(null);
    setAgreed(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            Agreement {index + 1} of {agreements.length} · please read and sign
          </p>
          <h2 className="truncate text-lg font-semibold">{agreement.title}</h2>
        </div>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Back to checkout
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl rounded-lg border bg-card p-4 text-sm leading-relaxed whitespace-pre-wrap">{agreement.body}</div>
      </div>
      <div className="border-t bg-card px-4 py-3">
        <div className="mx-auto grid max-w-3xl gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Full name</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} className="w-64" autoComplete="off" />
            </label>
            <div className="flex rounded-md border p-0.5 text-sm">
              {(["drawn", "typed"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setMethod(option)}
                  className={`rounded px-3 py-1.5 ${method === option ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                  {option === "drawn" ? "Sign with finger" : "Type name to agree"}
                </button>
              ))}
            </div>
          </div>
          {method === "drawn" ? <SignaturePad key={`${agreement.lineIndex}`} label="Sign here" onChange={setSignature} /> : null}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 size-4" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
            <span>
              I have read and agree to the {agreement.title}
              {method === "typed" ? ", and typing my name above is my electronic signature" : ""}.
            </span>
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            {index > 0 ? (
              <Button variant="outline" onClick={() => setIndex(index - 1)} disabled={saving}>
                Previous
              </Button>
            ) : null}
            <Button size="lg" onClick={next} disabled={!ready || saving}>
              {saving ? "Saving…" : last ? "Agree and finish" : "Agree and continue"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
