create table if not exists public.regular_slots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  student_id uuid not null,
  coach_id uuid,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  foreign key (student_id, org_id) references public.students(id, org_id) on delete cascade,
  foreign key (coach_id, org_id) references public.coaches(id, org_id) on delete set null (coach_id),
  check (end_time > start_time)
);

create index if not exists regular_slots_student_idx on public.regular_slots(student_id);
create index if not exists regular_slots_org_idx on public.regular_slots(org_id, coach_id);

create table if not exists public.office_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  coach_id uuid references public.coaches(id) on delete set null,
  month date not null,
  message text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create unique index if not exists office_requests_month_idx
  on public.office_requests(org_id, month, coalesce(coach_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.office_request_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.office_requests(id) on delete cascade,
  student_id uuid not null,
  coach_id uuid references public.coaches(id) on delete set null,
  date date not null,
  start_time time not null,
  end_time time not null,
  result text not null default 'pending' check (result in ('pending', 'matched', 'changed', 'missing')),
  appointment_id uuid references public.appointments(id) on delete set null,
  office_note text,
  updated_at timestamptz not null default now(),
  foreign key (student_id, org_id) references public.students(id, org_id) on delete cascade,
  check (end_time > start_time)
);

create index if not exists office_request_items_lookup_idx on public.office_request_items(org_id, date);
create index if not exists office_request_items_request_idx on public.office_request_items(request_id);

alter table public.regular_slots enable row level security;
alter table public.office_requests enable row level security;
alter table public.office_request_items enable row level security;

drop policy if exists regular_slots_select on public.regular_slots;
create policy regular_slots_select on public.regular_slots for select to authenticated using (public.is_org_member(org_id));
drop policy if exists regular_slots_write on public.regular_slots;
create policy regular_slots_write on public.regular_slots for all to authenticated
  using (public.has_org_role(org_id, array['admin', 'agent']))
  with check (public.has_org_role(org_id, array['admin', 'agent']));

drop policy if exists office_requests_select on public.office_requests;
create policy office_requests_select on public.office_requests for select to authenticated using (public.is_org_member(org_id));
drop policy if exists office_requests_write on public.office_requests;
create policy office_requests_write on public.office_requests for all to authenticated
  using (public.has_org_role(org_id, array['admin', 'agent']))
  with check (public.has_org_role(org_id, array['admin', 'agent']));

drop policy if exists office_request_items_select on public.office_request_items;
create policy office_request_items_select on public.office_request_items for select to authenticated using (public.is_org_member(org_id));
drop policy if exists office_request_items_write on public.office_request_items;
create policy office_request_items_write on public.office_request_items for all to authenticated
  using (public.has_org_role(org_id, array['admin', 'agent']))
  with check (public.has_org_role(org_id, array['admin', 'agent']));

grant select, insert, update, delete on public.regular_slots, public.office_requests, public.office_request_items to authenticated;
