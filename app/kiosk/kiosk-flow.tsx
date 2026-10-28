"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Users, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CameraCapture } from "@/components/crm/camera-capture";
import { SignaturePad } from "@/components/crm/signature-pad";
import { cn } from "@/lib/utils";

export type KioskConfig = {
  organizationName: string;
  logoUrl: string | null;
  sources: string[];
  sellers: { id: string; name: string }[];
  waiver: { id: string; version: number; body: string } | null;
};

type Step =
  | "welcome"
  | "referrer"
  | "contact"
  | "confirm"
  | "front_desk"
  | "details"
  | "heard"
  | "seller"
  | "photo"
  | "consent"
  | "waiver"
  | "done";

type VisitReason = "membership" | "guest_of_member";

type Lookup =
  | { result: "none" }
  | { result: "front_desk" }
  | {
      result: "match";
      displayName: string;
      matchToken: string;
      waiverOnFile: boolean;
      needsDetails: boolean;
      guardianRequired: boolean | null;
    };

const EMPTY_DETAILS = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  dateOfBirth: "",
  addressLine1: "",
  city: "",
  state: "",
  postalCode: "",
};

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

// "tx", "Tx", "Texas" -> "TX"; anything unrecognized -> null.
function stateCode(raw: string): string | null {
  const value = raw.trim().replace(/\./g, "").replace(/\s+/g, " ").toLowerCase();
  if (/^[a-z]{2}$/.test(value) && Object.values(US_STATES).includes(value.toUpperCase())) return value.toUpperCase();
  return US_STATES[value] ?? null;
}

const IDLE_RESET_MS = 120_000;
const DONE_RESET_MS = 10_000;
const NO_SELLER = "none";

// Under 18 today, on the iPad's clock (the server re-checks in the studio's
// time zone).
function isMinorLocal(dateOfBirth: string): boolean {
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  if (!year || !month || !day) return false;
  const today = new Date();
  const eighteenth = new Date(year + 18, month - 1, day);
  return eighteenth > new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function BigChoice({
  icon: Icon,
  title,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-40 flex-1 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-border bg-card p-8 text-center text-2xl font-semibold text-foreground shadow-sm transition hover:border-primary hover:bg-primary/5 focus-visible:border-primary focus-visible:outline-none active:translate-y-px"
    >
      <Icon className="size-10 text-primary" />
      {title}
    </button>
  );
}

function Field({
  id,
  label,
  className,
  ...props
}: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id} className="text-base">
        {label}
      </Label>
      <Input id={id} className="h-14 text-lg" {...props} />
    </div>
  );
}

function CheckRow({
  id,
  checked,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-16 cursor-pointer items-center gap-4 rounded-xl border-2 px-5 py-4 text-lg transition",
        checked ? "border-primary bg-primary/5" : "border-border bg-card",
      )}
    >
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} className="size-6" />
      <span className="flex-1">{children}</span>
    </label>
  );
}

export function KioskFlow({ config }: { config: KioskConfig }) {
  const [step, setStep] = useState<Step>("welcome");
  const [history, setHistory] = useState<Step[]>([]);
  const [visitReason, setVisitReason] = useState<VisitReason | null>(null);
  const [referrerName, setReferrerName] = useState("");
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  // Set when the guest confirms "Yes, that's me".
  const [matchToken, setMatchToken] = useState<string | null>(null);
  const [declinedMatchToken, setDeclinedMatchToken] = useState<string | null>(null);
  const [howHeard, setHowHeard] = useState<string[]>([]);
  const [sellerId, setSellerId] = useState<string>(NO_SELLER);
  const [photo, setPhoto] = useState<string | null>(null);
  const [consent, setConsent] = useState({ email: false, sms: false, photo: false });
  const [typedName, setTypedName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [guardianName, setGuardianName] = useState("");
  const [guardianSignature, setGuardianSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setStep("welcome");
    setHistory([]);
    setVisitReason(null);
    setReferrerName("");
    setDetails(EMPTY_DETAILS);
    setLookup(null);
    setMatchToken(null);
    setDeclinedMatchToken(null);
    setHowHeard([]);
    setSellerId(NO_SELLER);
    setPhoto(null);
    setConsent({ email: false, sms: false, photo: false });
    setTypedName("");
    setAgreed(false);
    setSignature(null);
    setGuardianName("");
    setGuardianSignature(null);
    setBusy(false);
    setError(null);
    window.scrollTo(0, 0);
  }, []);

  // Shared iPad: anything typed is wiped after two idle minutes, and the
  // thank-you screen returns to the start on its own.
  useEffect(() => {
    const arm = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (step !== "welcome") idleTimer.current = setTimeout(reset, step === "done" ? DONE_RESET_MS : IDLE_RESET_MS);
    };
    arm();
    window.addEventListener("pointerdown", arm);
    window.addEventListener("keydown", arm);
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, [step, reset]);

  function go(next: Step) {
    setError(null);
    // The signature pads start blank whenever the waiver step is shown, so
    // the saved signatures must too.
    if (next === "waiver") {
      setSignature(null);
      setGuardianSignature(null);
    }
    setHistory((previous) => [...previous, step]);
    setStep(next);
    window.scrollTo(0, 0);
  }

  function back() {
    setError(null);
    setHistory((previous) => {
      const copy = [...previous];
      const last = copy.pop();
      if (last) setStep(last);
      return copy;
    });
  }

  const returning = matchToken !== null && lookup?.result === "match";
  const minor =
    returning && lookup.guardianRequired !== null
      ? lookup.guardianRequired
      : details.dateOfBirth
        ? isMinorLocal(details.dateOfBirth)
        : false;
  const needsWaiver = !returning || !lookup.waiverOnFile;

  // Order of the remaining steps after the details step, for new vs
  // returning guests.
  function afterDetails(): Step {
    return returning ? "seller" : "heard";
  }
  function afterSeller(): Step | "submit" {
    if (!returning) return "photo";
    return needsWaiver ? "waiver" : "submit";
  }

  function setDetail(key: keyof typeof EMPTY_DETAILS, value: string) {
    setDetails((previous) => ({ ...previous, [key]: value }));
  }

  async function checkContact() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/kiosk/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: details.firstName,
          lastName: details.lastName,
          email: details.email,
          phone: details.phone,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error ?? "Something went wrong.");
      setLookup(result as Lookup);
      if (result.result === "match") go("confirm");
      else if (result.result === "front_desk") go("front_desk");
      else go("details");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        visitReason,
        sellerId: sellerId === NO_SELLER ? null : sellerId,
      };
      if (returning) {
        body.matchToken = matchToken;
        if (lookup.needsDetails) body.details = details;
      } else {
        body.details = details;
        body.referrerName = visitReason === "guest_of_member" ? referrerName : undefined;
        body.howHeard = howHeard;
        body.photo = photo;
        body.consent = consent;
        if (declinedMatchToken) body.declinedMatchToken = declinedMatchToken;
      }
      if (needsWaiver) {
        body.waiver = {
          templateId: config.waiver?.id,
          typedName,
          agreed,
          signature,
          guardianName: minor ? guardianName : undefined,
          guardianSignature: minor ? guardianSignature : undefined,
        };
      }

      const response = await fetch("/api/kiosk/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error ?? "Something went wrong.");
      setHistory([]);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  // What's still missing on each form step, so the guest is told exactly
  // which field to fix instead of facing a greyed-out button.
  const contactProblems = [
    !details.firstName.trim() && "first name",
    !details.lastName.trim() && "last name",
    details.phone.replace(/\D/g, "").length < 10 && "a mobile number (10 digits)",
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(details.email.trim()) && "a valid email",
  ].filter(Boolean) as string[];
  const detailsProblems = [
    !details.dateOfBirth && "date of birth",
    !details.addressLine1.trim() && "street address",
    !details.city.trim() && "city",
    !stateCode(details.state) && "state (for example TX)",
    !/^\d{5}(-\d{4})?$/.test(details.postalCode.trim()) && "ZIP code (5 digits)",
  ].filter(Boolean) as string[];
  const missingMessage = (problems: string[]) => `Please add ${problems.join(", ")}.`;
  const waiverReady =
    Boolean(config.waiver) &&
    agreed &&
    signature !== null &&
    typedName.trim().length > 2 &&
    (!minor || (guardianName.trim().length > 2 && guardianSignature !== null));

  const firstName = details.firstName.trim();

  let content: React.ReactNode;
  switch (step) {
    case "welcome":
      content = (
        <div className="space-y-10 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">What brings you in today?</h1>
          <div className="flex flex-col gap-6 sm:flex-row">
            <BigChoice
              icon={Ticket}
              title="Interested in a membership or pass"
              onClick={() => {
                setVisitReason("membership");
                go("contact");
              }}
            />
            <BigChoice
              icon={Users}
              title="Visiting with a friend who is a member"
              onClick={() => {
                setVisitReason("guest_of_member");
                go("referrer");
              }}
            />
          </div>
        </div>
      );
      break;

    case "referrer":
      content = (
        <form
          className="space-y-8"
          onSubmit={(event) => {
            event.preventDefault();
            go("contact");
          }}
        >
          <h1 className="text-3xl font-semibold tracking-tight">Who is the member you&apos;re visiting with?</h1>
          <Field
            id="referrer"
            label="Their first and last name"
            value={referrerName}
            onChange={(event) => setReferrerName(event.target.value)}
            autoComplete="off"
            maxLength={120}
          />
          <Button type="submit" className="h-14 w-full text-lg" disabled={referrerName.trim().split(/\s+/).length < 2}>
            Continue
          </Button>
        </form>
      );
      break;

    case "contact":
      content = (
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (contactProblems.length > 0) {
              setError(missingMessage(contactProblems));
              return;
            }
            void checkContact();
          }}
        >
          <h1 className="text-3xl font-semibold tracking-tight">Tell us about you</h1>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="first" label="First name" value={details.firstName} onChange={(e) => setDetail("firstName", e.target.value)} autoComplete="off" maxLength={60} />
            <Field id="last" label="Last name" value={details.lastName} onChange={(e) => setDetail("lastName", e.target.value)} autoComplete="off" maxLength={60} />
            <Field id="phone" label="Mobile number" type="tel" inputMode="tel" value={details.phone} onChange={(e) => setDetail("phone", e.target.value)} autoComplete="off" maxLength={30} />
            <Field id="email" label="Email" type="email" inputMode="email" autoCapitalize="none" value={details.email} onChange={(e) => setDetail("email", e.target.value)} autoComplete="off" maxLength={254} />
          </div>
          <Button type="submit" className="h-14 w-full text-lg" disabled={busy}>
            {busy ? "One moment…" : "Continue"}
          </Button>
        </form>
      );
      break;

    case "confirm":
      content =
        lookup?.result === "match" ? (
          <div className="space-y-10 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">Welcome back! Is this you?</h1>
            <p className="text-5xl font-semibold text-primary">{lookup.displayName}</p>
            <div className="flex flex-col gap-4 sm:flex-row">
              <Button
                variant="outline"
                className="h-16 flex-1 text-xl"
                onClick={() => {
                  setDeclinedMatchToken(lookup.matchToken);
                  setMatchToken(null);
                  go("details");
                }}
              >
                No, that&apos;s not me
              </Button>
              <Button
                className="h-16 flex-1 text-xl"
                onClick={() => {
                  setMatchToken(lookup.matchToken);
                  setDeclinedMatchToken(null);
                  go(lookup.needsDetails ? "details" : "seller");
                }}
              >
                Yes, that&apos;s me
              </Button>
            </div>
          </div>
        ) : null;
      break;

    case "front_desk":
      content = (
        <div className="space-y-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Thanks{firstName ? `, ${firstName}` : ""}!</h1>
          <p className="text-xl text-muted-foreground">
            Please see the front desk when you&apos;re done so we can make sure your details are right. Tap
            Continue to finish checking in.
          </p>
          <Button className="h-14 w-full text-lg" onClick={() => go("details")}>
            Continue
          </Button>
        </div>
      );
      break;

    case "details":
      content = (
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (detailsProblems.length > 0) {
              setError(missingMessage(detailsProblems));
              return;
            }
            setDetail("state", stateCode(details.state) ?? details.state);
            setDetail("postalCode", details.postalCode.trim());
            go(afterDetails());
          }}
        >
          <h1 className="text-3xl font-semibold tracking-tight">A few more details</h1>
          <div className="grid gap-5 sm:grid-cols-6">
            <Field
              id="dob"
              label="Date of birth"
              type="date"
              value={details.dateOfBirth}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDetail("dateOfBirth", e.target.value)}
              className="sm:col-span-6"
            />
            <Field id="street" label="Street address" value={details.addressLine1} onChange={(e) => setDetail("addressLine1", e.target.value)} autoComplete="off" maxLength={120} className="sm:col-span-6" />
            <Field id="city" label="City" value={details.city} onChange={(e) => setDetail("city", e.target.value)} autoComplete="off" maxLength={60} className="sm:col-span-3" />
            <Field id="state" label="State" value={details.state} onChange={(e) => setDetail("state", e.target.value)} autoComplete="off" maxLength={20} placeholder="TX" className="sm:col-span-1" />
            <Field id="zip" label="ZIP" inputMode="numeric" value={details.postalCode} onChange={(e) => setDetail("postalCode", e.target.value)} autoComplete="off" maxLength={10} className="sm:col-span-2" />
          </div>
          {details.dateOfBirth && minor ? (
            <p className="rounded-xl bg-muted px-5 py-4 text-base">
              Guests under 18 need a parent or guardian to sign the waiver with them.
            </p>
          ) : null}
          <Button type="submit" className="h-14 w-full text-lg">
            Continue
          </Button>
        </form>
      );
      break;

    case "heard":
      content = (
        <div className="space-y-6">
          <h1 className="text-3xl font-semibold tracking-tight">How did you hear about us?</h1>
          <p className="text-lg text-muted-foreground">Pick all that apply.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {config.sources.map((label, index) => (
              <CheckRow
                key={label}
                id={`heard-${index}`}
                checked={howHeard.includes(label)}
                onChange={(checked) =>
                  setHowHeard((previous) => (checked ? [...previous, label] : previous.filter((value) => value !== label)))
                }
              >
                {label}
              </CheckRow>
            ))}
          </div>
          <Button className="h-14 w-full text-lg" onClick={() => go("seller")}>
            Continue
          </Button>
        </div>
      );
      break;

    case "seller": {
      const next = afterSeller();
      content = (
        <div className="space-y-6">
          <h1 className="text-3xl font-semibold tracking-tight">Who are you meeting?</h1>
          <p className="text-lg text-muted-foreground">Optional. Leave it blank if you&apos;re not sure.</p>
          <Select value={sellerId} onValueChange={setSellerId}>
            <SelectTrigger className="h-14 w-full text-lg data-[size=default]:h-14">
              <SelectValue placeholder="Choose a team member" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SELLER} className="py-3 text-lg">
                —
              </SelectItem>
              {config.sellers.map((seller) => (
                <SelectItem key={seller.id} value={seller.id} className="py-3 text-lg">
                  {seller.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            className="h-14 w-full text-lg"
            disabled={busy}
            onClick={() => (next === "submit" ? void submit() : go(next))}
          >
            {next === "submit" ? (busy ? "Checking you in…" : "Check in") : "Continue"}
          </Button>
        </div>
      );
      break;
    }

    case "photo":
      content = (
        <div className="space-y-6">
          <h1 className="text-3xl font-semibold tracking-tight">Let&apos;s take your photo</h1>
          <p className="text-lg text-muted-foreground">So our team can welcome you by name.</p>
          <CameraCapture photo={photo} onChange={setPhoto} />
          <Button className="h-14 w-full text-lg" disabled={!photo} onClick={() => go("consent")}>
            Continue
          </Button>
        </div>
      );
      break;

    case "consent":
      content = (
        <div className="space-y-6">
          <h1 className="text-3xl font-semibold tracking-tight">Staying in touch</h1>
          <div className="space-y-3">
            <CheckRow id="consent-email" checked={consent.email} onChange={(email) => setConsent((c) => ({ ...c, email }))}>
              Email me news and offers from {config.organizationName}.
            </CheckRow>
            <CheckRow id="consent-sms" checked={consent.sms} onChange={(sms) => setConsent((c) => ({ ...c, sms }))}>
              Text me appointment confirmations and updates. Message and data rates may apply. Reply STOP to opt out.
            </CheckRow>
            <CheckRow id="consent-photo" checked={consent.photo} onChange={(value) => setConsent((c) => ({ ...c, photo: value }))}>
              I agree that {config.organizationName} may keep the photo I just took on my guest profile so staff can
              recognize me. It is not shared or used for marketing.
            </CheckRow>
          </div>
          <Button className="h-14 w-full text-lg" disabled={!consent.photo} onClick={() => go("waiver")}>
            Continue
          </Button>
        </div>
      );
      break;

    case "waiver":
      content = config.waiver ? (
        <div className="space-y-6">
          <h1 className="text-3xl font-semibold tracking-tight">Waiver</h1>
          <div className="max-h-[45vh] overflow-y-auto rounded-xl border bg-card p-5 text-base leading-relaxed whitespace-pre-wrap">
            {config.waiver.body}
          </div>
          <CheckRow id="agree" checked={agreed} onChange={setAgreed}>
            I have read this waiver and agree to it.
          </CheckRow>
          <SignaturePad label="Sign here" onChange={setSignature} />
          <Field
            id="typed-name"
            label={minor ? "Type your full name (or your parent or guardian's)" : "Type your full name"}
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            autoComplete="off"
            maxLength={120}
          />
          {minor ? (
            <Card>
              <CardContent className="space-y-5">
                <p className="text-lg font-medium">Parent or guardian</p>
                <p className="text-base text-muted-foreground">
                  This guest is under 18. A parent or guardian must sign to agree to the waiver on their behalf.
                </p>
                <Field
                  id="guardian-name"
                  label="Parent or guardian's full name"
                  value={guardianName}
                  onChange={(e) => setGuardianName(e.target.value)}
                  autoComplete="off"
                  maxLength={120}
                />
                <SignaturePad label="Parent or guardian signature" onChange={setGuardianSignature} />
              </CardContent>
            </Card>
          ) : null}
          <Button className="h-16 w-full text-xl" disabled={!waiverReady || busy} onClick={() => void submit()}>
            {busy ? "Checking you in…" : "Submit and check in"}
          </Button>
        </div>
      ) : (
        <p className="text-center text-xl">The waiver isn&apos;t available right now. Please see the front desk.</p>
      );
      break;

    case "done":
      content = (
        <div className="space-y-6 text-center">
          <CheckCircle2 className="mx-auto size-20 text-primary" />
          <h1 className="text-4xl font-semibold tracking-tight">You&apos;re checked in{firstName ? `, ${firstName}` : ""}!</h1>
          <p className="text-xl text-muted-foreground">Have a seat and a team member will be right with you.</p>
          <Button variant="outline" className="h-14 px-10 text-lg" onClick={reset}>
            Done
          </Button>
        </div>
      );
      break;
  }

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between gap-4 border-b bg-card px-6 py-4">
        <div className="flex items-center gap-3">
          {config.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={config.logoUrl} alt="" className="h-10 w-auto max-w-40 object-contain" />
          ) : null}
          <span className="text-xl font-semibold">{config.organizationName}</span>
        </div>
        {step !== "welcome" && step !== "done" ? (
          <Button variant="ghost" className="h-12 px-4 text-base" onClick={reset}>
            Start over
          </Button>
        ) : null}
      </header>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-10">
        {history.length > 0 && step !== "done" ? (
          <Button variant="ghost" className="mb-6 h-12 self-start px-3 text-base" onClick={back} disabled={busy}>
            <ArrowLeft className="size-5" /> Back
          </Button>
        ) : null}
        {content}
        {error ? (
          <p role="alert" className="mt-6 rounded-xl bg-destructive/10 px-5 py-4 text-center text-lg text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
