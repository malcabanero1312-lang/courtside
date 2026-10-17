create or replace function public.move_venue_bookings(
  p_from uuid,
  p_to uuid,
  p_student uuid default null,
  p_upcoming_only boolean default false
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_to_org uuid;
  a record;
  v_court uuid;
  n int := 0;
begin
  select org_id into v_org from public.venues where id = p_from;
  select org_id into v_to_org from public.venues where id = p_to;
  if v_org is null or v_to_org is null or v_org <> v_to_org then
    raise exception 'Choose two venues from your club.' using errcode = 'P0001';
  end if;
  if p_from = p_to then
    raise exception 'Choose a different venue to move to.' using errcode = 'P0001';
  end if;
  if not public.has_org_role(v_org, array['admin', 'agent']) then
    raise exception 'You do not have access to these venues.' using errcode = '42501';
  end if;

  for a in
    select ap.id, ap.court_id, ap.starts_at, ap.ends_at, ap.share_group, oc.name as court_name, oc.alt_name as court_alt
    from public.appointments ap
    left join public.courts oc on oc.id = ap.court_id
    where ap.venue_id = p_from
      and (p_student is null or ap.student_id = p_student)
      and (not p_upcoming_only or ap.ends_at > now())
  loop
    v_court := null;
    if a.court_id is not null then
      select c.id into v_court
      from public.courts c
      where c.venue_id = p_to
        and (lower(c.name) = lower(a.court_name)
             or lower(coalesce(c.alt_name, '')) = lower(a.court_name)
             or (a.court_alt is not null and lower(c.name) = lower(a.court_alt)))
      limit 1;
      if v_court is not null and exists (
        select 1 from public.appointments x
        where x.court_id = v_court
          and x.id <> a.id
          and public.appointment_is_active(x.status)
          and tstzrange(x.starts_at, x.ends_at, '[)') && tstzrange(a.starts_at, a.ends_at, '[)')
          and (a.share_group is null or x.share_group is distinct from a.share_group)
      ) then
        v_court := null;
      end if;
    end if;
    update public.appointments set venue_id = p_to, court_id = v_court where id = a.id;
    n := n + 1;
  end loop;

  update public.regular_slots set venue_id = p_to
  where venue_id = p_from and (p_student is null or student_id = p_student);
  update public.monthly_confirmations set venue_id = p_to
  where venue_id = p_from and (p_student is null or student_id = p_student);

  return n;
end;
$$;

create or replace function public.delete_venue(p_venue uuid, p_move_to uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  n int := 0;
begin
  select org_id into v_org from public.venues where id = p_venue;
  if v_org is null then
    raise exception 'Venue not found.' using errcode = 'P0001';
  end if;
  if not public.has_org_role(v_org, array['admin']) then
    raise exception 'Only admins can delete venues.' using errcode = '42501';
  end if;
  if p_move_to is not null then
    n := public.move_venue_bookings(p_venue, p_move_to, null, false);
  end if;
  if exists (select 1 from public.appointments where venue_id = p_venue) then
    raise exception 'This venue still has bookings. Choose a venue to move them to first.' using errcode = 'P0001';
  end if;
  delete from public.venues where id = p_venue;
  return n;
end;
$$;

grant execute on function public.move_venue_bookings(uuid, uuid, uuid, boolean) to authenticated;
grant execute on function public.delete_venue(uuid, uuid) to authenticated;
