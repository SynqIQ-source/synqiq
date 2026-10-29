import { DateTime } from "luxon";

// "Preset or pick dates" periods from URL params (range/start/end), in the
// org's timezone. Presets: "mtd", "today", "last_month", "custom", or a
// number of days ("7", "30", "60"...) ending today.
const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

export type Period = {
  preset: string;
  from: DateTime;
  to: DateTime;
  // What the date inputs should show.
  start: string;
  end: string;
};

export function resolvePeriod(
  params: { range?: string; start?: string; end?: string },
  options: { presets: string[]; fallback: string; timezone: string },
): Period {
  const now = DateTime.now().setZone(options.timezone);
  let preset = params.range && options.presets.includes(params.range) ? params.range : options.fallback;

  const fromPreset = (value: string): { from: DateTime; to: DateTime } => {
    if (value === "today") return { from: now.startOf("day"), to: now.endOf("day") };
    if (value === "last_month") {
      const month = now.minus({ months: 1 });
      return { from: month.startOf("month"), to: month.endOf("month") };
    }
    if (/^\d+$/.test(value))
      return { from: now.minus({ days: Number(value) - 1 }).startOf("day"), to: now.endOf("day") };
    return { from: now.startOf("month"), to: now.endOf("day") };
  };

  let { from, to } = fromPreset(preset === "custom" ? options.fallback : preset);
  if (preset === "custom") {
    const customFrom =
      params.start && DATE_PARAM.test(params.start)
        ? DateTime.fromISO(params.start, { zone: options.timezone }).startOf("day")
        : null;
    const customTo =
      params.end && DATE_PARAM.test(params.end)
        ? DateTime.fromISO(params.end, { zone: options.timezone }).endOf("day")
        : null;
    if (customFrom?.isValid && customTo?.isValid && customFrom <= customTo) {
      from = customFrom;
      to = customTo;
    } else {
      preset = options.fallback;
    }
  }
  return { preset, from, to, start: from.toISODate()!, end: to.toISODate()! };
}
