-- Per-studio Mindbody connection (lib/sync/sites.ts).
--
-- The nightly syncs used to run for the one site in MINDBODY_SITE_ID. They
-- now run for every organization marked connected: the Source login reads
-- any site that has approved Synq's activation link. The Preserve is the
-- only connected studio today; the LastSpot sandbox org (site -99) and a
-- future Demo Studio stay unconnected.

begin;

alter table organizations
  add column mindbody_connected boolean not null default false;

update organizations set mindbody_connected = true where mindbody_site_id = 561843;

commit;
