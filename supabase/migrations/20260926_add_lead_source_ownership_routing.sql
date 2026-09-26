-- Lead source and owner routing foundation.
--
-- Rollout-safe migration:
-- - keeps existing contact/event columns intact
-- - backfills all historical Zion records to their canonical source/owner
-- - leaves application validation and PII retention policy server-side

alter table public.leads
  add column if not exists lead_owner text;

alter table public.lead_events
  add column if not exists source text,
  add column if not exists lead_owner text;

update public.leads
set source = 'zion-website'
where tenant_id = 'zion-energy'
  and (
    source is null
    or btrim(source) = ''
    or source = 'beta-calculator'
  );

update public.leads
set lead_owner = 'zion-energy'
where tenant_id = 'zion-energy'
  and (
    lead_owner is null
    or btrim(lead_owner) = ''
  );

update public.lead_events as event
set source = lead.source
from public.leads as lead
where event.lead_id = lead.lead_id
  and (event.source is null or btrim(event.source) = '')
  and lead.source is not null
  and btrim(lead.source) <> '';

update public.lead_events as event
set lead_owner = lead.lead_owner
from public.leads as lead
where event.lead_id = lead.lead_id
  and (event.lead_owner is null or btrim(event.lead_owner) = '')
  and lead.lead_owner is not null
  and btrim(lead.lead_owner) <> '';

update public.lead_events
set source = 'zion-website'
where tenant_id = 'zion-energy'
  and (
    source is null
    or btrim(source) = ''
  );

update public.lead_events
set lead_owner = 'zion-energy'
where tenant_id = 'zion-energy'
  and (
    lead_owner is null
    or btrim(lead_owner) = ''
  );

create index if not exists leads_source_idx
  on public.leads (source);

create index if not exists leads_lead_owner_idx
  on public.leads (lead_owner);

create index if not exists lead_events_source_idx
  on public.lead_events (source);

create index if not exists lead_events_lead_owner_idx
  on public.lead_events (lead_owner);
