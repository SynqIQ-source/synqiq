-- class_visits became a UNION ALL view (20261120200000_unified_attendance), so
-- PostgREST can no longer infer its link to class_occurrences from the base
-- table's foreign key, and embeds like
--   class_visits?select=...,class_occurrences!inner(...)
-- failed ("Could not find a relationship"), taking down /dashboard. A computed
-- relationship restores the embed. Runs as the caller (not security definer),
-- so class_occurrences RLS still applies.
create or replace function public.class_occurrences(public.class_visits)
returns setof public.class_occurrences
rows 1
language sql
stable
as $$
  select * from public.class_occurrences where id = $1.occurrence_id
$$;

grant execute on function public.class_occurrences(public.class_visits) to authenticated, service_role;

notify pgrst, 'reload schema';
