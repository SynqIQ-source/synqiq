"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Mail, MessageSquare, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type ThreadMessage = {
  id: string;
  channel: "sms" | "email" | "call" | "web";
  direction: "outbound" | "inbound";
  body: string;
  subject: string | null;
  // An email reply from an address other than the guest's on file.
  fromAddress?: string | null;
  // Date and time in the studio's time zone, e.g. "Oct 29, 2026, 2:14 PM".
  at: string;
  sender: string;
  status: string;
  error: string | null;
};

type ChannelState = { ok: true } | { ok: false; reason: string };

const REFRESH_MS = 20_000;

// One conversation per guest: texts and emails together, oldest first, each
// with who sent it and the date and time it went out or came in.
export function MessageThread({
  contactId,
  messages,
  sms,
  email,
}: {
  contactId: string;
  messages: ThreadMessage[];
  sms: ChannelState;
  email: ChannelState;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<"sms" | "email" | "call">(sms.ok || !email.ok ? "sms" : "email");
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const selected: ChannelState = channel === "sms" ? sms : channel === "email" ? email : { ok: true };

  // New replies show up without reloading while the thread is open.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/crm/contacts/${contactId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, body: text, subject: channel === "email" ? subject : undefined }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error ?? "Couldn't send the message.");
      setText("");
      setSubject("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the message.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="max-h-[32rem] space-y-4 overflow-y-auto px-1 py-2">
        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          messages.map((message) => {
            const outbound = message.direction === "outbound";
            // Calls and website forms read as notes in the thread, not chat bubbles.
            const note = message.channel === "call" || message.channel === "web";
            const Icon =
              message.channel === "sms" ? MessageSquare : message.channel === "call" ? Phone : message.channel === "web" ? Globe : Mail;
            return (
              <div key={message.id} className={cn("flex", outbound ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[80%] space-y-1 px-3.5 py-2.5 text-sm leading-relaxed",
                    note
                      ? "rounded-xl border border-dashed border-amber-300 bg-amber-50 text-foreground dark:bg-amber-950/30"
                      : outbound
                        ? "rounded-2xl rounded-br-md bg-primary text-primary-foreground"
                        : "rounded-2xl rounded-bl-md bg-muted text-foreground",
                  )}
                >
                  {message.subject && message.channel === "email" ? <p className="text-xs font-semibold">{message.subject}</p> : null}
                  {message.fromAddress ? (
                    <p className="text-xs text-muted-foreground">From {message.fromAddress} (not the email on file)</p>
                  ) : null}
                  {message.channel === "call" ? <p className="text-xs font-semibold">Call logged</p> : null}
                  {message.channel === "web" ? <p className="text-xs font-semibold">{message.subject ?? "Website form"}</p> : null}
                  <p className="whitespace-pre-wrap">{message.body}</p>
                  <p
                    className={cn(
                      "flex items-center gap-1.5 text-[11px]",
                      outbound && !note ? "text-primary-foreground/80" : "text-muted-foreground",
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {message.sender} · {message.at}
                    {outbound && message.status === "delivered" ? " · Delivered" : null}
                  </p>
                  {message.status === "failed" ? (
                    <p className="text-[11px] font-medium text-destructive">{message.error ?? "Not delivered"}</p>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="space-y-2">
        <div role="tablist" aria-label="Send as" className="flex gap-1 border-b">
          {(
            [
              ["sms", MessageSquare, "Text"],
              ["email", Mail, "Email"],
              ["call", Phone, "Log call"],
            ] as const
          ).map(([value, TabIcon, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={channel === value}
              onClick={() => setChannel(value)}
              className={cn(
                "-mb-px inline-flex min-h-10 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors",
                channel === value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <TabIcon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        {!selected.ok ? (
          <p className="text-sm text-muted-foreground">{selected.reason}</p>
        ) : (
          <>
            {channel === "email" ? (
              <Input
                value={subject}
                maxLength={200}
                placeholder="Subject (optional; replies keep the thread's subject)"
                onChange={(event) => setSubject(event.target.value)}
              />
            ) : null}
            <Textarea
              value={text}
              maxLength={channel === "sms" ? 1000 : 20000}
              placeholder={channel === "sms" ? "Write a text…" : channel === "email" ? "Write an email…" : "What happened on the call?"}
              className="min-h-20"
              onChange={(event) => setText(event.target.value)}
            />
            <div className="flex items-center justify-between gap-3">
              {error ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {channel === "sms"
                    ? `${text.length}/1000 · texts send 8 AM–9 PM (replies from 6 AM)`
                    : channel === "email"
                      ? "Sent from your name at the studio"
                      : "Saved to the thread; nothing is sent"}
                </span>
              )}
              <Button type="submit" size="sm" disabled={busy || !text.trim()}>
                {busy ? "Saving…" : channel === "call" ? "Log call" : "Send"}
              </Button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
