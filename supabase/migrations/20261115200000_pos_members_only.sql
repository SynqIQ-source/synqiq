-- Members-only items: personal training and Pilates can only be sold to
-- someone with an active membership (or who buys one in the same sale).
-- A switch per item; turned on for those categories except the intro
-- items prospects get (Assessment and Intro Workout, InBody Eval).

alter table pos_items add column if not exists members_only boolean not null default false;

update pos_items i
set members_only = true
from revenue_categories rc
where rc.id = i.revenue_category_id
  and rc.key in ('personal_training', 'pilates')
  and i.name not in ('Assessment and Intro Workout', 'InBody Eval');
