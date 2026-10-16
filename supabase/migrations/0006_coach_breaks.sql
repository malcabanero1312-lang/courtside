create table if not exists public.coach_breaks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  coach_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  label text check (label is null or char_length(label) <= 60),
  foreign key (coach_id, org_id) references public.coaches(id, org_id) on delete cascade,
  check (end_time > start_time)
);

create index if not exists coach_breaks_coach_idx on public.coach_breaks(coach_id, weekday);

alter table public.coach_breaks enable row level security;

drop policy if exists coach_breaks_select on public.coach_breaks;
create policy coach_breaks_select on public.coach_breaks for select to authenticated using (public.is_org_member(org_id));

drop policy if exists coach_breaks_write on public.coach_breaks;
create policy coach_breaks_write on public.coach_breaks for all to authenticated
  using (public.has_org_role(org_id, array['admin'])
         or exists (select 1 from public.coaches c where c.id = coach_id and c.user_id = auth.uid()))
  with check (public.has_org_role(org_id, array['admin'])
         or exists (select 1 from public.coaches c where c.id = coach_id and c.user_id = auth.uid() and c.org_id = coach_breaks.org_id));

create or replace function public.slot_issues(
  p_org uuid,
  p_coach uuid,
  p_venue uuid,
  p_court uuid,
  p_starts timestamptz,
  p_ends timestamptz,
  p_student uuid default null,
  p_exclude uuid default null
) returns table (code text, severity text, message text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_local_start timestamp;
  v_local_end timestamp;
  v_venue public.venues%rowtype;
  v_coach public.coaches%rowtype;
  v_court public.courts%rowtype;
  r record;
begin
  if not public.is_org_member(p_org) then
    raise exception 'You do not have access to this organization.' using errcode = '42501';
  end if;

  select timezone into v_tz from public.organizations where id = p_org;
  v_local_start := p_starts at time zone v_tz;
  v_local_end := p_ends at time zone v_tz;

  select * into v_coach from public.coaches where id = p_coach and org_id = p_org;
  select * into v_venue from public.venues where id = p_venue and org_id = p_org;
  if p_court is not null then
    select * into v_court from public.courts where id = p_court and org_id = p_org;
  end if;

  if p_ends <= p_starts then
    return query select 'invalid_time', 'block', 'The end time must be after the start time.';
    return;
  end if;
  if v_coach.id is null then
    return query select 'coach_missing', 'block', 'Choose a coach.';
  elsif not v_coach.is_active then
    return query select 'coach_inactive', 'block', format('%s is marked as inactive.', v_coach.full_name);
  end if;
  if v_venue.id is null then
    return query select 'venue_missing', 'block', 'Choose a venue.';
  elsif not v_venue.is_active then
    return query select 'venue_inactive', 'block', format('%s is marked as inactive.', v_venue.name);
  end if;
  if p_court is not null and (v_court.id is null or v_court.venue_id is distinct from p_venue) then
    return query select 'court_mismatch', 'block', 'The selected court is not part of the selected venue.';
  elsif p_court is not null and not v_court.is_active then
    return query select 'court_inactive', 'block', format('%s is marked as inactive.', v_court.name);
  end if;

  for r in
    select a.starts_at, a.ends_at, s.full_name as student_name
    from public.appointments a
    join public.students s on s.id = a.student_id
    where a.org_id = p_org and a.coach_id = p_coach
      and public.appointment_is_active(a.status)
      and (p_exclude is null or a.id <> p_exclude)
      and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_starts, p_ends, '[)')
    order by a.starts_at
  loop
    return query select 'coach_busy', 'block', format('Coach %s already has a session with %s from %s to %s.',
      v_coach.full_name, r.student_name,
      to_char(r.starts_at at time zone v_tz, 'FMHH12:MI AM'), to_char(r.ends_at at time zone v_tz, 'FMHH12:MI AM'));
  end loop;

  if p_court is not null then
    for r in
      select a.starts_at, a.ends_at
      from public.appointments a
      where a.org_id = p_org and a.court_id = p_court
        and public.appointment_is_active(a.status)
        and (p_exclude is null or a.id <> p_exclude)
        and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_starts, p_ends, '[)')
      order by a.starts_at
    loop
      return query select 'court_busy', 'block', format('%s is already booked from %s to %s.',
        v_court.name, to_char(r.starts_at at time zone v_tz, 'FMHH12:MI AM'), to_char(r.ends_at at time zone v_tz, 'FMHH12:MI AM'));
    end loop;
  end if;

  for r in
    select b.coach_id, b.venue_id, b.court_id, b.reason
    from public.blocked_times b
    where b.org_id = p_org
      and (b.coach_id = p_coach or b.venue_id = p_venue or (p_court is not null and b.court_id = p_court))
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_starts, p_ends, '[)')
  loop
    return query select 'blocked', 'block', format('%s is unavailable at this time%s.',
      case when r.coach_id is not null then 'Coach ' || v_coach.full_name
           when r.venue_id is not null then v_venue.name
           else v_court.name end,
      case when coalesce(r.reason, '') <> '' then ' (' || r.reason || ')' else '' end);
  end loop;

  for r in
    select b.start_time, b.end_time, b.label
    from public.coach_breaks b
    where b.coach_id = p_coach
      and b.weekday = extract(dow from v_local_start)::int
      and v_local_start::date = v_local_end::date
      and b.start_time < v_local_end::time
      and b.end_time > v_local_start::time
    order by b.start_time
  loop
    return query select 'coach_break', 'block', format('Coach %s has a break from %s to %s%s.',
      v_coach.full_name, to_char(r.start_time, 'FMHH12:MI AM'), to_char(r.end_time, 'FMHH12:MI AM'),
      case when coalesce(r.label, '') <> '' then ' (' || r.label || ')' else '' end);
  end loop;

  if p_starts < now() then
    return query select 'in_past', 'warn', 'This time is in the past.';
  end if;

  if v_venue.id is not null and (
      v_local_start::date <> v_local_end::date
      or v_local_start::time < v_venue.opens_at
      or v_local_end::time > v_venue.closes_at) then
    return query select 'outside_venue_hours', 'warn', format('%s is open from %s to %s.',
      v_venue.name, to_char(v_venue.opens_at, 'FMHH12:MI AM'), to_char(v_venue.closes_at, 'FMHH12:MI AM'));
  end if;

  if exists (select 1 from public.coach_availability where coach_id = p_coach)
     and not exists (
       select 1 from public.coach_availability ca
       where ca.coach_id = p_coach
         and ca.weekday = extract(dow from v_local_start)::int
         and ca.start_time <= v_local_start::time
         and ca.end_time >= v_local_end::time
         and v_local_start::date = v_local_end::date) then
    return query select 'outside_coach_hours', 'warn', format('This is outside Coach %s''s usual working hours.', v_coach.full_name);
  end if;

  if p_student is not null then
    for r in
      select a.starts_at, c.full_name as coach_name
      from public.appointments a
      join public.coaches c on c.id = a.coach_id
      where a.org_id = p_org and a.student_id = p_student
        and public.appointment_is_active(a.status)
        and (p_exclude is null or a.id <> p_exclude)
        and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_starts, p_ends, '[)')
    loop
      return query select 'student_busy', 'warn', format('This student already has a session with Coach %s at %s.',
        r.coach_name, to_char(r.starts_at at time zone v_tz, 'FMHH12:MI AM'));
    end loop;
  end if;
end;
$$;

create or replace function public.suggest_slots(
  p_org uuid,
  p_coach uuid,
  p_venue uuid,
  p_court uuid,
  p_from timestamptz,
  p_duration_minutes int,
  p_exclude uuid default null,
  p_limit int default 6
) returns table (starts_at timestamptz, ends_at timestamptz, court_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org public.organizations%rowtype;
  v_venue public.venues%rowtype;
  v_has_avail boolean;
  v_day date;
  v_local timestamp;
  v_start timestamptz;
  v_end timestamptz;
  v_found int := 0;
  v_court uuid;
  v_candidate_court uuid;
  v_ok boolean;
  v_courts uuid[];
begin
  if not public.is_org_member(p_org) then
    raise exception 'You do not have access to this organization.' using errcode = '42501';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 15 or p_duration_minutes > 480 then
    return;
  end if;

  select * into v_org from public.organizations where id = p_org;
  select * into v_venue from public.venues where id = p_venue and org_id = p_org;
  if v_venue.id is null then
    return;
  end if;

  v_has_avail := exists (select 1 from public.coach_availability where coach_id = p_coach);

  if p_court is not null then
    select array_agg(id order by (id = p_court) desc, name) into v_courts
    from public.courts where venue_id = p_venue and is_active;
  end if;

  v_day := (greatest(p_from, now()) at time zone v_org.timezone)::date;

  for d in 0..13 loop
    exit when v_found >= p_limit;
    v_local := (v_day + d) + v_venue.opens_at;
    while v_local + make_interval(mins => p_duration_minutes) <= (v_day + d) + v_venue.closes_at loop
      exit when v_found >= p_limit;
      v_start := v_local at time zone v_org.timezone;
      v_end := v_start + make_interval(mins => p_duration_minutes);

      if v_start >= greatest(p_from, now())
         and (not v_has_avail or exists (
              select 1 from public.coach_availability ca
              where ca.coach_id = p_coach
                and ca.weekday = extract(dow from v_local)::int
                and ca.start_time <= v_local::time
                and ca.end_time >= (v_local + make_interval(mins => p_duration_minutes))::time)) then

        v_ok := not exists (
          select 1 from public.appointments a
          where a.coach_id = p_coach and public.appointment_is_active(a.status)
            and (p_exclude is null or a.id <> p_exclude)
            and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(v_start, v_end, '[)'))
          and not exists (
          select 1 from public.blocked_times b
          where b.org_id = p_org and (b.coach_id = p_coach or b.venue_id = p_venue)
            and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(v_start, v_end, '[)'))
          and not exists (
          select 1 from public.coach_breaks cb
          where cb.coach_id = p_coach
            and cb.weekday = extract(dow from v_local)::int
            and cb.start_time < (v_local + make_interval(mins => p_duration_minutes))::time
            and cb.end_time > v_local::time);

        v_court := null;
        if v_ok and p_court is not null then
          v_ok := false;
          foreach v_candidate_court in array coalesce(v_courts, array[]::uuid[]) loop
            if not exists (
                select 1 from public.appointments a
                where a.court_id = v_candidate_court and public.appointment_is_active(a.status)
                  and (p_exclude is null or a.id <> p_exclude)
                  and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(v_start, v_end, '[)'))
               and not exists (
                select 1 from public.blocked_times b
                where b.court_id = v_candidate_court
                  and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(v_start, v_end, '[)')) then
              v_court := v_candidate_court;
              v_ok := true;
              exit;
            end if;
          end loop;
        end if;

        if v_ok then
          starts_at := v_start;
          ends_at := v_end;
          court_id := v_court;
          v_found := v_found + 1;
          return next;
        end if;
      end if;

      v_local := v_local + make_interval(mins => v_org.slot_step_minutes);
    end loop;
  end loop;
end;
$$;
