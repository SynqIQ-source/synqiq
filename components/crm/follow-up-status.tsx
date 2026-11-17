import { DateTime } from "luxon";
import { Badge } from "@/components/ui/badge";
import { formatHours, STOPPED_LABELS, type FirstContact, type FollowUp } from "@/lib/crm/follow-ups";

// Time to first contact, against the 48-hour rule.
export function FirstContactBadge({ firstContact }: { firstContact: FirstContact }) {
  if (firstContact.state === "on_time" || firstContact.state === "late") {
    return (
      <span className="whitespace-nowrap">
        <span className="tabular-nums">{formatHours(firstContact.hours)}</span>{" "}
        <Badge variant={firstContact.state === "on_time" ? "secondary" : "destructive"} className="ml-1">
          {firstContact.state === "on_time" ? "On time" : "Late"}
        </Badge>
      </span>
    );
  }
  if (firstContact.state === "overdue") {
    return (
      <Badge variant="destructive" className="whitespace-nowrap">
        Not contacted · {formatHours(firstContact.hours)}
      </Badge>
    );
  }
  if (firstContact.state === "pending") {
    return (
      <Badge variant="outline" className="whitespace-nowrap">
        Due in {formatHours(firstContact.hoursLeft)}
      </Badge>
    );
  }
  return null;
}

// The next follow-up, or the appointment it's waiting on: the headline
// (badge or date) with the details on a second line, so table columns stay
// narrow enough to fit without scrolling sideways.
const STACK = "inline-flex flex-col items-start gap-0.5";
const DETAIL = "text-xs whitespace-nowrap text-muted-foreground";

export function NextFollowUp({ followUp, timezone }: { followUp: FollowUp; timezone: string }) {
  if (followUp.kind === "stopped") {
    return <span className="text-muted-foreground">{STOPPED_LABELS[followUp.reason]}</span>;
  }
  if (followUp.kind === "pool") {
    return (
      <span className={STACK}>
        <Badge variant="secondary">Warm lead pool</Badge>
        <span className={DETAIL}>
          since {DateTime.fromISO(followUp.since, { zone: timezone }).toFormat("LLL d")} · {followUp.attempts} attempts, no reply
        </span>
      </span>
    );
  }
  if (followUp.kind === "waiting") {
    return (
      <span className={STACK}>
        <Badge variant="outline">All {followUp.attempts} attempts made</Badge>
        <span className={DETAIL}>warm pool {DateTime.fromISO(followUp.poolOn, { zone: timezone }).toFormat("ccc LLL d")} if no reply</span>
      </span>
    );
  }
  if (followUp.kind === "appointment") {
    return (
      <span className={STACK}>
        <span className="whitespace-nowrap">Appointment</span>
        <span className={DETAIL}>{DateTime.fromISO(followUp.at).setZone(timezone).toFormat("ccc LLL d, h:mm a")}</span>
      </span>
    );
  }
  const date = DateTime.fromISO(followUp.dueOn, { zone: timezone }).toFormat("ccc LLL d");
  const detail = [
    followUp.daysOverdue >= 0 ? date : null,
    followUp.rescheduled ? "rescheduled" : `attempt ${followUp.attempt} of ${followUp.of}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className={STACK}>
      {followUp.daysOverdue > 0 ? (
        <Badge variant="destructive">{followUp.daysOverdue === 1 ? "1 day overdue" : `${followUp.daysOverdue} days overdue`}</Badge>
      ) : followUp.daysOverdue === 0 ? (
        <Badge>Due today</Badge>
      ) : (
        <span className="whitespace-nowrap">{date}</span>
      )}
      <span className={DETAIL}>{detail}</span>
    </span>
  );
}
