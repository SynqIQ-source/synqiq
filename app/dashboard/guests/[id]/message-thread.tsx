"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type ThreadMessage = {
  id: string;
  channel: "sms" | "email";
  direction: "outbound" | "inbound";
  body: string;
  subject: string | null;
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
  const [channel, setChannel] = useState<"sms" | "email">(sms.ok || !email.ok ? "sms" : "email");
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const selected = channel === "sms" ? sms : email;

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
      <div className="max-h-[28rem] space-y-3 overflow-y-auto rounded-lg border bg-muted/30 p-3">
        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          messages.map((message) => {
            const outbound = message.direction === "outbound";
            const Icon = message.channel === "sms" ? MessageSquare : Mail;
            return (
              <div key={message.id} className={cn("flex", outbound ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] space-y-1 rounded-xl px-3 py-2 text-sm",
                    outbound ? "bg-primary text-primary-foreground" : "border bg-card text-foreground",
                  )}
                >
                  {message.subject && message.channel === "email" ? (
                    <p className="text-xs font-semibold">{message.subject}</p>
                  ) : null}
                  <p className="whitespace-pre-wrap">{message.body}</p>
                  <p
                    className={cn(
                      "flex items-center gap-1.5 text-[11px]",
                      outbound ? "text-primary-foreground/80" : "text-muted-foreground",
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
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={channel === "sms" ? "default" : "outline"}
            onClick={() => setChannel("sms")}
          >
            <MessageSquare /> Text
          </Button>
          <Button
            type="button"
            size="sm"
            variant={channel === "email" ? "default" : "outline"}
            onClick={() => setChannel("email")}
          >
            <Mail /> Email
          </Button>
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
              placeholder={channel === "sms" ? "Write a text…" : "Write an email…"}
              className="min-h-20"
              onChange={(event) => setText(event.target.value)}
            />
            <div className="flex items-center justify-between gap-3">
              {error ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {channel === "sms" ? `${text.length}/1000 · texts send 8 AM–9 PM` : "Sent from your name at the studio"}
                </span>
              )}
              <Button type="submit" size="sm" disabled={busy || !text.trim()}>
                {busy ? "Sending…" : "Send"}
              </Button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
