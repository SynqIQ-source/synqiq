-- Category pictures (2026-11-24): a picture for each inventory category tile
-- on Products & Inventory and the checkout. Stored in the existing public
-- pos-images bucket like item pictures. Without one, the tile keeps showing
-- the first item's picture (or the first letter). Additive only.

alter table public.inventory_categories
  add column if not exists image_url text;
