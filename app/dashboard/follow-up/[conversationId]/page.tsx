import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { StaffNotProvisioned } from "@/components/staff-not-provisioned";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { ReplyBox } from "./reply-box";

const TITLE = "Follow Up";

type ConversationRow = {
  id: string;
  instructor_id: string;
  client_id: string;
  subject: string;
  created_at: string;
};

type MessageRow = {
  id: string;
  direction: "outbound" | "inbound";
  body_text: string;
  created_at: string;
};

async function getOrgTimezone(supabase: ScopedSupabaseClient) {
  const { data } = await supabase.from("organizations").select("timezone").limit(1).maybeSingle();
  return data?.timezone ?? "utc";
}

export default async function FollowUpThreadPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const currentStaff = await getCurrentStaff();

  if (!currentStaff) {
    return (
      <DashboardShell title={TITLE} description="">
        <StaffNotProvisioned />
      </DashboardShell>
    );
  }

  const supabase = await getScopedClient(currentStaff);

  // RLS already scopes this to the caller's org; the instructor_id check
  // below narrows it to this instructor's own threads (an admin in the
  // same org may also open it).
  const { data: conversation } = await supabase
    .from("followup_conversations")
    .select("id, instructor_id, client_id, subject, created_at")
    .eq("id", conversationId)
    .maybeSingle<ConversationRow>();

  if (!conversation) {
    notFound();
  }
  if (conversation.instructor_id !== currentStaff.id && currentStaff.role !== "admin") {
    notFound();
  }

  const [{ data: client }, { data: messageData }, timezone] = await Promise.all([
    supabase
      .from("clients")
      .select("first_name, last_name")
      .eq("id", conversation.client_id)
      .maybeSingle<{ first_name: string; last_name: string }>(),
    supabase
      .from("followup_messages")
      .select("id, direction, body_text, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .returns<MessageRow[]>(),
    getOrgTimezone(supabase),
  ]);

  const memberName = client ? `${client.first_name} ${client.last_name}`.trim() : "Member";
  const messages = messageData ?? [];
  const isOwn = conversation.instructor_id === currentStaff.id;

  return (
    <DashboardShell title={TITLE} description={`Conversation with ${memberName}`}>
      <div className="mb-4">
        <Link href="/dashboard/follow-up" className="text-sm text-accent hover:underline">
          &larr; Back to Follow Up
        </Link>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 p-4">
          <h2 className="text-base font-semibold text-zinc-950">{conversation.subject}</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            with {memberName} &middot; started{" "}
            {DateTime.fromISO(conversation.created_at, { zone: "utc" })
              .setZone(timezone)
              .toFormat("MMM d, yyyy")}
          </p>
        </div>

        <ol className="space-y-4 p-4">
          {messages.length === 0 ? (
            <li className="text-sm text-zinc-500">No messages yet.</li>
          ) : (
            messages.map((message) => {
              const fromInstructor = message.direction === "outbound";
              return (
                <li
                  key={message.id}
                  className={fromInstructor ? "flex justify-end" : "flex justify-start"}
                >
                  <div
                    className={
                      fromInstructor
                        ? "max-w-[80%] rounded-lg bg-accent px-4 py-2 text-sm text-white"
                        : "max-w-[80%] rounded-lg bg-zinc-100 px-4 py-2 text-sm text-zinc-950"
                    }
                  >
                    <p className="whitespace-pre-wrap break-words">{message.body_text}</p>
                    <p
                      className={
                        fromInstructor
                          ? "mt-1 text-xs text-white/70"
                          : "mt-1 text-xs text-zinc-500"
                      }
                    >
                      {fromInstructor ? "You" : memberName} &middot;{" "}
                      {DateTime.fromISO(message.created_at, { zone: "utc" })
                        .setZone(timezone)
                        .toFormat("MMM d, h:mm a")}
                    </p>
                  </div>
                </li>
              );
            })
          )}
        </ol>

        {isOwn ? (
          <div className="border-t border-zinc-200 p-4">
            <ReplyBox conversationId={conversation.id} />
          </div>
        ) : (
          <div className="border-t border-zinc-200 p-4 text-sm text-zinc-500">
            Only {memberName}&apos;s instructor can reply in this thread.
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
