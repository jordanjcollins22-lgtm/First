-- The 3D job model: one per job.
--
-- The beds come from the site map (canvas_designs) and are not copied here.
-- What is kept is what the office adds on top: every plant in the beds with
-- its size and whether it stays, is new or comes out; the order of the work
-- where the office changed it from the default; where the truck parks; and a
-- walk-around video or link to show beside the model.
--
-- plants: [{id, name, status: keep|new|remove, heightFt, spreadFt, areaId, at: [lng, lat] | null, note?}]
-- steps:  [{id, title?, minutes?, tools?}] in the office's order; empty means the default order.
-- truck:  [lng, lat] or null.
--
-- Same business only, like the rest of a job. Who may change it (whoever
-- runs jobs) is checked by the server before it writes.
--
-- Additive only. No `drop ... if exists` (NOTICEs hang the SQL runner); the
-- policy is made in a guarded DO block.

create table if not exists public.job_models (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  organization_id uuid not null default current_org_id() references public.organizations(id) on delete cascade,
  plants jsonb not null default '[]'::jsonb check (jsonb_typeof(plants) = 'array'),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  truck jsonb,
  video_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create index if not exists job_models_org_idx on public.job_models (organization_id, updated_at desc);

comment on table public.job_models is
  'The 3D job model: plants (keep/new/remove, sized), the office''s order of work and the truck spot, over the site map''s beds.';

alter table public.job_models enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'job_models' and policyname = 'job_models_own_org') then
    create policy job_models_own_org on public.job_models
      for all to authenticated
      using (organization_id = (select current_org_id()))
      with check (organization_id = (select current_org_id()));
  end if;
end
$$;
