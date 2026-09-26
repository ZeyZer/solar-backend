-- ZeyZer tenant ownership foundation.
--
-- Rollout-safe migration:
-- - existing records are backfilled to the current Zion Energy tenant
-- - columns remain nullable temporarily so frontend/backend/database
--   deployments do not have to happen atomically
-- - application code remains responsible for validating known tenants

alter table public.leads
  add column if not exists tenant_id text;

alter table public.lead_events
  add column if not exists tenant_id text;

-- All records created before multi-tenant support belong to the current
-- Zion Energy deployment.
update public.leads
set tenant_id = 'zion-energy'
where tenant_id is null
   or btrim(tenant_id) = '';

-- Prefer the owning lead's tenant for historical events.
update public.lead_events as event
set tenant_id = lead.tenant_id
from public.leads as lead
where event.lead_id = lead.lead_id
  and (event.tenant_id is null or btrim(event.tenant_id) = '')
  and lead.tenant_id is not null
  and btrim(lead.tenant_id) <> '';

-- Defensive fallback for any historical event without a matching lead row.
update public.lead_events
set tenant_id = 'zion-energy'
where tenant_id is null
   or btrim(tenant_id) = '';

create index if not exists leads_tenant_id_idx
  on public.leads (tenant_id);

create index if not exists lead_events_tenant_id_idx
  on public.lead_events (tenant_id);
