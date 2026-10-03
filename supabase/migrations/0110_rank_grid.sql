-- Where we show up, and where we don't.
--
-- "We rank #4 for lawn care" is close to meaningless: local results move with
-- where the person searching is standing, and two streets apart can be first
-- place and nowhere. So a ranking is not a number, it is a map — a grid of
-- points around the yard, each one asking where we would come if somebody
-- searched from there.

create table if not exists rank_keywords (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  phrase text not null,
  active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),

  -- Tracking the same phrase twice would give two answers to one question.
  unique (organization_id, phrase)
);

create index if not exists rank_keywords_org_idx on rank_keywords(organization_id, active);

alter table rank_keywords enable row level security;
drop policy if exists "org_scoped_rank_keywords" on rank_keywords;
create policy "org_scoped_rank_keywords" on rank_keywords for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- ============================================================
-- One run of the grid
-- ============================================================
-- The centre, size and spacing are stored with the run rather than looked up
-- later: a grid checked from a different centre is a different question, and
-- comparing it to last month's would be comparing two different maps.
create table if not exists rank_scans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  keyword_id uuid not null references rank_keywords(id) on delete cascade,

  centre_lat double precision not null,
  centre_lng double precision not null,
  grid_size int not null check (grid_size between 3 and 9),
  spacing_miles numeric not null check (spacing_miles > 0),

  -- 'api' when a lookup filled it in, 'manual' when a person did.
  source text not null default 'manual' check (source in ('api', 'manual')),
  note text,

  ran_at timestamptz not null default now(),
  ran_by uuid references profiles(id)
);

create index if not exists rank_scans_keyword_idx on rank_scans(keyword_id, ran_at desc);
create index if not exists rank_scans_org_idx on rank_scans(organization_id, ran_at desc);

alter table rank_scans enable row level security;
drop policy if exists "org_scoped_rank_scans" on rank_scans;
create policy "org_scoped_rank_scans" on rank_scans for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- ============================================================
-- One point on the grid
-- ============================================================
create table if not exists rank_points (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references rank_scans(id) on delete cascade,

  grid_row int not null check (grid_row >= 0),
  grid_col int not null check (grid_col >= 0),
  lat double precision not null,
  lng double precision not null,

  -- Null means we were not in the results at all, which is different from
  -- being last and has to stay different.
  rank int check (rank is null or rank > 0),

  unique (scan_id, grid_row, grid_col)
);

create index if not exists rank_points_scan_idx on rank_points(scan_id);

alter table rank_points enable row level security;
drop policy if exists "org_scoped_rank_points" on rank_points;
create policy "org_scoped_rank_points" on rank_points for all to authenticated
  using (
    exists (
      select 1 from rank_scans s
      where s.id = rank_points.scan_id and s.organization_id = current_org_id()
    )
  )
  with check (
    exists (
      select 1 from rank_scans s
      where s.id = rank_points.scan_id and s.organization_id = current_org_id()
    )
  );

notify pgrst, 'reload schema';
