-- Backfill attendance_rate for rows where the class has already occurred and
-- had at least one booking, using the same logic verified in
-- app/dashboard/page.tsx: total_signed_in / total_booked * 100. Classes with
-- no bookings, or whose start_datetime is still in the future, are left
-- NULL rather than 0 -- attendance isn't a meaningful concept for either
-- case (see conversation history for the reasoning). Idempotent: safe to
-- re-run, since it only ever derives attendance_rate from the other stored
-- columns.

UPDATE class_occurrences
SET attendance_rate = ROUND((total_signed_in::numeric / total_booked::numeric) * 100, 2)
WHERE total_booked > 0
  AND start_datetime IS NOT NULL
  AND start_datetime <= now();
