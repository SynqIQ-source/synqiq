-- substitution_interests originally only tracked "said yes" via row
-- presence. Instructors also need to explicitly decline (distinct from not
-- having responded at all), so a response can now be 'interested' or
-- 'declined' -- same table, since both are the same underlying event (an
-- instructor responding to a request), just with a different outcome.
-- Renaming expressed_at -> responded_at since it no longer only means
-- "expressed interest".

ALTER TABLE substitution_interests
  RENAME COLUMN expressed_at TO responded_at;

ALTER TABLE substitution_interests
  ADD COLUMN status text NOT NULL DEFAULT 'interested'
    CHECK (status IN ('interested', 'declined'));

COMMENT ON TABLE substitution_interests IS
  'Which staff responded to a given substitution_requests row, and how (interested or declined). UNIQUE(request_id, staff_id) makes responding idempotent for a repeated identical response; a differing second response is rejected at the application layer (first response is locked in, not silently overwritten).';
