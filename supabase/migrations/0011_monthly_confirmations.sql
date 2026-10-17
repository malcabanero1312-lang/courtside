create table if not exists public.monthly_confirmations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  student_id uuid not null,
  coach_id uuid references public.coaches(id) on delete set null,
  venue_id uuid references public.venues(id) on delete set null,
  month date not null,
  token text not null unique check (char_length(token) >= 24),
  entries jsonb not null default '[]'::jsonb,
  status text not null default 'sent' check (status in ('sent', 'confirmed', 'change_requested', 'declined')),
  student_note text check (student_note is null or char_length(student_note) <= 600),
  answered_by text check (answered_by is null or answered_by in ('student', 'staff')),
  sent_at timestamptz not null default now(),
  responded_at timestamptz,
  office_sent_at timestamptz,
  assigned_agent_id uuid references public.memberships(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (student_id, org_id) references public.students(id, org_id) on delete cascade
);

create unique index if not exists monthly_confirmations_student_month_idx
  on public.monthly_confirmations(student_id, month, coalesce(coach_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists monthly_confirmations_org_month_idx on public.monthly_confirmations(org_id, month);

alter table public.appointments add column if not exists monthly_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_monthly_fk') then
    alter table public.appointments
      add constraint appointments_monthly_fk foreign key (monthly_id) references public.monthly_confirmations(id) on delete set null;
  end if;
end $$;

create index if not exists appointments_monthly_idx on public.appointments(monthly_id) where monthly_id is not null;

alter table public.monthly_confirmations enable row level security;

drop policy if exists monthly_confirmations_select on public.monthly_confirmations;
create policy monthly_confirmations_select on public.monthly_confirmations for select to authenticated using (public.is_org_member(org_id));
drop policy if exists monthly_confirmations_write on public.monthly_confirmations;
create policy monthly_confirmations_write on public.monthly_confirmations for all to authenticated
  using (public.has_org_role(org_id, array['admin', 'agent']))
  with check (public.has_org_role(org_id, array['admin', 'agent']));

grant select, insert, update, delete on public.monthly_confirmations to authenticated;

create or replace function public.materialize_monthly(p_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_tz text;
  e jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_other record;
  v_group uuid;
  n int := 0;
begin
  select * into r from public.monthly_confirmations where id = p_id;
  if not found or r.coach_id is null or r.venue_id is null then
    return 0;
  end if;
  select timezone into v_tz from public.organizations where id = r.org_id;

  for e in select * from jsonb_array_elements(r.entries) loop
    begin
      v_start := ((e->>'date')::date + (e->>'start')::time) at time zone v_tz;
      v_end := ((e->>'date')::date + (e->>'end')::time) at time zone v_tz;
    exception when others then
      continue;
    end;
    if v_end <= v_start then
      continue;
    end if;

    if exists (
      select 1 from public.appointments a
      where a.student_id = r.student_id and a.starts_at = v_start and public.appointment_is_active(a.status)
    ) then
      continue;
    end if;

    v_group := null;
    select a.id, a.share_group into v_other
    from public.appointments a
    where a.coach_id = r.coach_id and a.starts_at = v_start and a.ends_at = v_end and public.appointment_is_active(a.status)
    limit 1;
    if found then
      v_group := coalesce(v_other.share_group, gen_random_uuid());
      update public.appointments
      set share_group = v_group
      where coach_id = r.coach_id and starts_at = v_start and ends_at = v_end
        and public.appointment_is_active(status) and share_group is null;
    end if;

    begin
      insert into public.appointments (org_id, reference, student_id, coach_id, venue_id, starts_at, ends_at,
                                       status, office_approved, assigned_agent_id, share_group, monthly_id)
      values (r.org_id, '', r.student_id, r.coach_id, r.venue_id, v_start, v_end,
              'pending_approval', false, r.assigned_agent_id, v_group, r.id);
      n := n + 1;
    exception when exclusion_violation then
      null;
    end;
  end loop;
  return n;
end;
$$;

revoke all on function public.materialize_monthly(uuid) from public, anon, authenticated;

create or replace function public.get_monthly_page(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
begin
  if p_token is null or char_length(p_token) < 24 or char_length(p_token) > 128 then
    return jsonb_build_object('found', false);
  end if;
  select m.status, m.entries, m.month, m.student_note, m.responded_at, m.answered_by,
         split_part(s.full_name, ' ', 1) as first_name, c.full_name as coach, v.name as venue,
         o.name as org_name, o.brand_color, o.contact_phone, o.timezone
  into r
  from public.monthly_confirmations m
  join public.students s on s.id = m.student_id
  join public.organizations o on o.id = m.org_id
  left join public.coaches c on c.id = m.coach_id
  left join public.venues v on v.id = m.venue_id
  where m.token = p_token;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'status', r.status,
    'entries', r.entries,
    'month', to_char(r.month, 'YYYY-MM'),
    'student_note', r.student_note,
    'answered_by', r.answered_by,
    'student_first_name', r.first_name,
    'coach', r.coach,
    'venue', r.venue,
    'org_name', r.org_name,
    'brand_color', r.brand_color,
    'contact_phone', r.contact_phone,
    'timezone', r.timezone
  );
end;
$$;

create or replace function public.respond_monthly(p_token text, p_action text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_action not in ('confirm', 'change', 'decline') then
    return jsonb_build_object('ok', false, 'error', 'Please choose one of the options.');
  end if;
  select * into r from public.monthly_confirmations where token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'This link is not valid.');
  end if;
  if r.status <> 'sent' then
    return jsonb_build_object('ok', false, 'error', 'Your answer was already recorded.', 'status', r.status);
  end if;
  if p_action = 'change' and v_note is null then
    return jsonb_build_object('ok', false, 'error', 'Please tell us what you would like to change.');
  end if;

  update public.monthly_confirmations
  set status = case p_action when 'confirm' then 'confirmed' when 'change' then 'change_requested' else 'declined' end,
      student_note = left(v_note, 600),
      answered_by = 'student',
      responded_at = now()
  where id = r.id;

  if p_action = 'confirm' then
    perform public.materialize_monthly(r.id);
  end if;

  return jsonb_build_object('ok', true, 'status',
    case p_action when 'confirm' then 'confirmed' when 'change' then 'change_requested' else 'declined' end);
end;
$$;

create or replace function public.staff_confirm_monthly(p_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  select * into r from public.monthly_confirmations where id = p_id;
  if not found or not public.has_org_role(r.org_id, array['admin', 'agent']) then
    raise exception 'You do not have access to this schedule.' using errcode = '42501';
  end if;
  update public.monthly_confirmations
  set status = 'confirmed', answered_by = 'staff', responded_at = now()
  where id = p_id;
  return public.materialize_monthly(p_id);
end;
$$;

create or replace function public.staff_reset_monthly(p_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int;
begin
  select * into r from public.monthly_confirmations where id = p_id;
  if not found or not public.has_org_role(r.org_id, array['admin', 'agent']) then
    raise exception 'You do not have access to this schedule.' using errcode = '42501';
  end if;
  delete from public.appointments where monthly_id = p_id and status = 'pending_approval';
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.get_monthly_page(text) to anon, authenticated;
grant execute on function public.respond_monthly(text, text, text) to anon, authenticated;
grant execute on function public.staff_confirm_monthly(uuid) to authenticated;
grant execute on function public.staff_reset_monthly(uuid) to authenticated;
