import { DateTime } from "luxon";

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) {
    return `${remainingMinutes}m`;
  }

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

/**
 * "6:00 AM - 6:50 AM CDT (50m)", or just "6:00 AM CDT" when there's no
 * end_datetime yet (rows synced before that column existed, or MindBody
 * omitted it) -- no duration is guessed in that case.
 */
export function formatClassTime(
  startDatetime: string | null,
  endDatetime: string | null,
  timezone: string | null,
) {
  if (!startDatetime) {
    return "N/A";
  }

  const zone = timezone ?? "utc";
  const start = DateTime.fromISO(startDatetime, { zone: "utc" }).setZone(zone);

  if (!endDatetime) {
    return start.toFormat("h:mm a ZZZZ");
  }

  const end = DateTime.fromISO(endDatetime, { zone: "utc" }).setZone(zone);
  const durationMinutes = Math.round(end.diff(start, "minutes").minutes);

  if (durationMinutes <= 0) {
    return start.toFormat("h:mm a ZZZZ");
  }

  return `${start.toFormat("h:mm a")} - ${end.toFormat("h:mm a ZZZZ")} (${formatDuration(durationMinutes)})`;
}
