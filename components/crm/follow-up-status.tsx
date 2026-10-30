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

// The next follow-up, or the appointment it's waiting on.
export function NextFollowUp({ followUp, timezone }: { followUp: FollowUp; timezone: string }) {
  if (followUp.kind === "stopped") {
    return <span className="text-muted-foreground">{STOPPED_LABELS[followUp.reason]}</span>;
  }
  if (followUp.kind === "appointment") {
    return (
      <span className="whitespace-nowrap">
        Appointment {DateTime.fromISO(followUp.at).setZone(timezone).toFormat("ccc LLL d, h:mm a")}
      </span>
    );
  }
  const date = DateTime.fromISO(followUp.dueOn, { zone: timezone }).toFormat("ccc LLL d");
  return (
    <span className="whitespace-nowrap">
      {followUp.daysOverdue > 0 ? (
        <Badge variant="destructive">
          {followUp.daysOverdue === 1 ? "1 day overdue" : `${followUp.daysOverdue} days overdue`}
        </Badge>
      ) : followUp.daysOverdue === 0 ? (
        <Badge>Due today</Badge>
      ) : (
        date
      )}
      {followUp.daysOverdue >= 0 ? <span className="ml-1.5 text-xs text-muted-foreground">{date}</span> : null}
      {followUp.rescheduled ? <span className="ml-1.5 text-xs text-muted-foreground">(rescheduled)</span> : null}
    </span>
  );
}
