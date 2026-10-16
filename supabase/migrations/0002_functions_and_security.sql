create or replace function public.seed_organization_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.session_types (org_id, name, duration_minutes) values
    (p_org, 'Private lesson', 60),
    (p_org, 'Semi-private lesson', 60),
    (p_org, 'Group clinic', 90),
    (p_org, 'Trial lesson', 45)
  on conflict do nothing;

  insert into public.message_templates (org_id, key, channel, name, subject, body) values
  (p_org, 'appointment_request', 'whatsapp', 'New appointment', null,
'Hi {{student_first_name}}! 🎾

This is {{agent_name}} from {{org_name}}. Your tennis session is booked:

📅 {{date}}
⏰ {{time}} ({{duration}})
📍 {{venue}}{{court_line}}
👤 Coach {{coach}}

Please confirm, decline or ask for another time here:
{{response_link}}

See you on court!'),
  (p_org, 'follow_up', 'whatsapp', 'Follow-up (no reply yet)', null,
'Hi {{student_first_name}}, just checking in about your session on {{date}} at {{time}} with Coach {{coach}}.

Could you let us know if it still works for you? It takes one tap:
{{response_link}}

Thank you!'),
  (p_org, 'reminder', 'whatsapp', 'Reminder', null,
'Hi {{student_first_name}}, a friendly reminder of your tennis session:

📅 {{date}} at {{time}}
📍 {{venue}}{{court_line}}
👤 Coach {{coach}}

Need to change something? {{response_link}}'),
  (p_org, 'rescheduled', 'whatsapp', 'Rescheduled appointment', null,
'Hi {{student_first_name}}, your session has a new time:

📅 {{date}}
⏰ {{time}} ({{duration}})
📍 {{venue}}{{court_line}}
👤 Coach {{coach}}

Please confirm the new time here:
{{response_link}}'),
  (p_org, 'student_confirmed', 'email', 'Student: booking confirmed',
'Confirmed: {{session_type}} on {{date}} at {{time}}',
'Hi {{student_first_name}},

Thank you for confirming. Here are your session details:

Date: {{date}}
Time: {{time}} ({{duration}})
Venue: {{venue}}{{court_line}}
Address: {{venue_address}}
Coach: {{coach}}
Reference: {{reference}}

If anything changes, you can update your response here:
{{response_link}}

{{cancellation_policy}}

See you on court,
{{org_name}}'),
  (p_org, 'student_cancelled', 'email', 'Student: appointment cancelled',
'Cancelled: your session on {{date}}',
'Hi {{student_first_name}},

Your {{session_type}} on {{date}} at {{time}} with Coach {{coach}} has been cancelled.
{{cancellation_reason_line}}
Reply to this email or message us on WhatsApp if you would like to book another time.

{{org_name}}'),
  (p_org, 'student_rescheduled', 'email', 'Student: appointment rescheduled',
'New time: {{date}} at {{time}}',
'Hi {{student_first_name}},

Your session has been moved to a new time:

Date: {{date}}
Time: {{time}} ({{duration}})
Venue: {{venue}}{{court_line}}
Coach: {{coach}}

Please confirm the new time here:
{{response_link}}

{{org_name}}'),
  (p_org, 'student_reminder', 'email', 'Student: reminder',
'Reminder: tennis on {{date}} at {{time}}',
'Hi {{student_first_name}},

This is a reminder of your upcoming session:

Date: {{date}}
Time: {{time}} ({{duration}})
Venue: {{venue}}{{court_line}}
Address: {{venue_address}}
Coach: {{coach}}

Need to change something? {{response_link}}

{{org_name}}'),
  (p_org, 'staff_student_response', 'email', 'Staff: student responded',
'{{student_name}} {{status_label_lower}} ({{date}} {{time}})',
'{{student_name}} has responded: {{status_label}}.

Session: {{session_type}}
Date: {{date}} at {{time}}
Coach: {{coach}}
Venue: {{venue}}{{court_line}}
Student note: {{student_note}}

Open the appointment: {{appointment_url}}'),
  (p_org, 'staff_cancelled', 'email', 'Staff: appointment cancelled',
'Cancelled: {{student_name}} on {{date}} {{time}}',
'The session with {{student_name}} on {{date}} at {{time}} has been cancelled.
{{cancellation_reason_line}}
Open the appointment: {{appointment_url}}'),
  (p_org, 'staff_rescheduled', 'email', 'Staff: appointment rescheduled',
'Rescheduled: {{student_name}} now {{date}} {{time}}',
'The session with {{student_name}} has been moved to {{date}} at {{time}} ({{duration}}) at {{venue}}{{court_line}}.

Open the appointment: {{appointment_url}}')
  on conflict (org_id, channel, key) do nothing;
end;
$$;

create or replace function public.restore_default_templates(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_org_role(p_org, array['admin']) then
    raise exception 'Only admins can restore templates.' using errcode = '42501';
  end if;
  perform public.seed_organization_defaults(p_org);
end;
$$;

create or replace function public.create_organization(
  p_name text, p_timezone text, p_full_name text, p_country_code text default '63'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;
  if not public.is_valid_timezone(p_timezone) then
    raise exception 'Unknown time zone "%".', p_timezone using errcode = 'P0001';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  insert into public.organizations (name, timezone, default_country_code)
  values (btrim(p_name), p_timezone, coalesce(nullif(p_country_code, ''), '63'))
  returning id into v_org;

  insert into public.memberships (org_id, user_id, role, full_name, email)
  values (v_org, auth.uid(), 'admin', coalesce(btrim(p_full_name), ''), coalesce(v_email, ''));

  perform public.seed_organization_defaults(v_org);
  return v_org;
end;
$$;

create or replace function public.accept_invitations()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user auth.users%rowtype;
  v_count int := 0;
  inv record;
  v_membership uuid;
begin
  select * into v_user from auth.users where id = auth.uid();
  if v_user.id is null or v_user.email is null or v_user.email_confirmed_at is null then
    return 0;
  end if;

  for inv in
    select * from public.invitations
    where lower(email) = lower(v_user.email) and accepted_at is null and revoked_at is null
    for update
  loop
    insert into public.memberships (org_id, user_id, role, full_name, email)
    values (inv.org_id, v_user.id, inv.role, coalesce(inv.full_name, ''), v_user.email)
    on conflict (org_id, user_id) do nothing
    returning id into v_membership;

    if inv.coach_id is not null then
      update public.coaches set user_id = v_user.id
      where id = inv.coach_id and org_id = inv.org_id and user_id is null;
    end if;

    update public.invitations set accepted_at = now() where id = inv.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.memberships_protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    if not exists (
      select 1 from public.memberships
      where org_id = old.org_id and role = 'admin' and id <> old.id
    ) then
      raise exception 'Every organization needs at least one admin. Make someone else an admin first.'
        using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger memberships_protect_last_admin
before update or delete on public.memberships
for each row execute function public.memberships_protect_last_admin();

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
            and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(v_start, v_end, '[)'));

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

create or replace function public.create_appointment(
  p_org uuid,
  p_student uuid,
  p_coach uuid,
  p_venue uuid,
  p_court uuid,
  p_session_type uuid,
  p_local_start timestamp,
  p_duration_minutes int,
  p_agent uuid,
  p_notes text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tz text;
  v_start timestamptz;
  v_id uuid;
begin
  if not public.has_org_role(p_org, array['admin', 'agent']) then
    raise exception 'Only admins and agents can create appointments.' using errcode = '42501';
  end if;
  select timezone into v_tz from public.organizations where id = p_org;
  v_start := p_local_start at time zone v_tz;

  insert into public.appointments (org_id, reference, student_id, coach_id, venue_id, court_id, session_type_id,
    starts_at, ends_at, assigned_agent_id, notes, created_by)
  values (p_org, '', p_student, p_coach, p_venue, p_court, p_session_type,
    v_start, v_start + make_interval(mins => p_duration_minutes), p_agent, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.reschedule_appointment(
  p_appointment uuid,
  p_coach uuid,
  p_venue uuid,
  p_court uuid,
  p_local_start timestamp,
  p_duration_minutes int,
  p_expected_version int
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old public.appointments%rowtype;
  v_tz text;
  v_start timestamptz;
  v_id uuid;
begin
  select * into v_old from public.appointments where id = p_appointment for update;
  if v_old.id is null then
    raise exception 'Appointment not found.' using errcode = 'P0002';
  end if;
  if not public.has_org_role(v_old.org_id, array['admin', 'agent']) then
    raise exception 'Only admins and agents can reschedule appointments.' using errcode = '42501';
  end if;
  if p_expected_version is not null and v_old.version <> p_expected_version then
    raise exception 'Someone else changed this appointment a moment ago. Please reload and try again.'
      using errcode = 'P0001', hint = 'stale_version';
  end if;
  if v_old.status in ('cancelled', 'rescheduled', 'completed', 'no_show') then
    raise exception 'This appointment is % and can no longer be rescheduled.', replace(v_old.status, '_', ' ')
      using errcode = 'P0001';
  end if;

  select timezone into v_tz from public.organizations where id = v_old.org_id;
  v_start := p_local_start at time zone v_tz;

  update public.appointments set status = 'rescheduled' where id = v_old.id;

  insert into public.appointments (org_id, reference, student_id, coach_id, venue_id, court_id, session_type_id,
    starts_at, ends_at, assigned_agent_id, notes, rescheduled_from_id, created_by)
  values (v_old.org_id, '', v_old.student_id, p_coach, p_venue, p_court, v_old.session_type_id,
    v_start, v_start + make_interval(mins => p_duration_minutes), v_old.assigned_agent_id, v_old.notes, v_old.id, auth.uid())
  returning id into v_id;

  update public.response_links set revoked_at = now()
  where appointment_id = v_old.id and revoked_at is null;

  return v_id;
end;
$$;

create or replace function public.change_appointment_status(
  p_appointment uuid,
  p_status text,
  p_reason text default null,
  p_expected_version int default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old public.appointments%rowtype;
begin
  select * into v_old from public.appointments where id = p_appointment for update;
  if v_old.id is null then
    raise exception 'Appointment not found.' using errcode = 'P0002';
  end if;
  if p_expected_version is not null and v_old.version <> p_expected_version then
    raise exception 'Someone else changed this appointment a moment ago. Please reload and try again.'
      using errcode = 'P0001', hint = 'stale_version';
  end if;
  if p_status = 'rescheduled' then
    raise exception 'Use the Reschedule action to move an appointment.' using errcode = 'P0001';
  end if;

  update public.appointments
  set status = p_status,
      cancellation_reason = case when p_status = 'cancelled' then nullif(btrim(coalesce(p_reason, '')), '') else cancellation_reason end,
      contacted_at = case when p_status = 'awaiting_response' then coalesce(contacted_at, now()) else contacted_at end
  where id = p_appointment;

  if not found then
    raise exception 'You do not have permission to change this appointment.' using errcode = '42501';
  end if;

  if p_status = 'cancelled' then
    update public.response_links set revoked_at = now()
    where appointment_id = p_appointment and revoked_at is null;
  end if;
end;
$$;

create or replace function public.log_appointment_event(
  p_appointment uuid,
  p_event_type text,
  p_details jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if p_event_type not in ('whatsapp_opened', 'whatsapp_marked_sent', 'link_copied', 'link_regenerated', 'note', 'calendar_downloaded') then
    raise exception 'Unknown event type.' using errcode = 'P0001';
  end if;
  select org_id into v_org from public.appointments where id = p_appointment;
  if v_org is null or not public.has_org_role(v_org, array['admin', 'agent', 'coach']) then
    raise exception 'You do not have access to this appointment.' using errcode = '42501';
  end if;
  if public.has_org_role(v_org, array['coach']) and not public.has_org_role(v_org, array['admin', 'agent'])
     and not exists (select 1 from public.appointments a join public.coaches c on c.id = a.coach_id
                     where a.id = p_appointment and c.user_id = auth.uid()) then
    raise exception 'You do not have access to this appointment.' using errcode = '42501';
  end if;

  insert into public.appointment_events (org_id, appointment_id, event_type, actor_type, actor_user_id, actor_name, details)
  values (v_org, p_appointment, p_event_type, 'staff', auth.uid(), public.current_actor_name(v_org), coalesce(p_details, '{}'::jsonb));

  if p_event_type = 'whatsapp_marked_sent' then
    update public.appointments
    set contacted_at = now(),
        status = case when status = 'scheduled' then 'awaiting_response' else status end
    where id = p_appointment;
  end if;
end;
$$;

create or replace function public.get_response_page(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_link public.response_links%rowtype;
  r record;
  v_state text;
begin
  if p_token is null or char_length(p_token) < 24 or char_length(p_token) > 128 then
    return jsonb_build_object('found', false);
  end if;

  select * into v_link from public.response_links where token = p_token;
  if v_link.id is null then
    return jsonb_build_object('found', false);
  end if;

  select a.id, a.reference, a.status, a.starts_at, a.ends_at, a.student_note, a.responded_at,
         s.full_name as student_name, c.full_name as coach_name, v.name as venue_name, v.address as venue_address,
         v.maps_url, ct.name as court_name, st.name as session_type, o.name as org_name, o.timezone,
         o.brand_color, o.cancellation_policy
  into r
  from public.appointments a
  join public.students s on s.id = a.student_id
  join public.coaches c on c.id = a.coach_id
  join public.venues v on v.id = a.venue_id
  left join public.courts ct on ct.id = a.court_id
  left join public.session_types st on st.id = a.session_type_id
  join public.organizations o on o.id = a.org_id
  where a.id = v_link.appointment_id;

  v_state := case
    when v_link.revoked_at is not null then 'revoked'
    when v_link.expires_at < now() then 'expired'
    when r.starts_at <= now() then 'past'
    when not public.appointment_is_active(r.status) and r.status <> 'declined' then 'closed'
    else 'open'
  end;

  return jsonb_build_object(
    'found', true,
    'state', v_state,
    'reference', r.reference,
    'status', r.status,
    'starts_at', r.starts_at,
    'ends_at', r.ends_at,
    'timezone', r.timezone,
    'student_first_name', split_part(btrim(r.student_name), ' ', 1),
    'coach', r.coach_name,
    'venue', r.venue_name,
    'venue_address', r.venue_address,
    'maps_url', r.maps_url,
    'court', r.court_name,
    'session_type', r.session_type,
    'org_name', r.org_name,
    'brand_color', r.brand_color,
    'cancellation_policy', r.cancellation_policy,
    'student_note', r.student_note,
    'responded_at', r.responded_at
  );
end;
$$;

create or replace function public.submit_student_response(p_token text, p_action text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.response_links%rowtype;
  v_appt public.appointments%rowtype;
  v_target text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_token is null or char_length(p_token) < 24 or char_length(p_token) > 128 then
    return jsonb_build_object('ok', false, 'error', 'This link is not valid.');
  end if;
  if p_action not in ('confirm', 'decline', 'reschedule') then
    return jsonb_build_object('ok', false, 'error', 'Please choose one of the options.');
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    return jsonb_build_object('ok', false, 'error', 'Please keep your note under 500 characters.');
  end if;
  if p_action = 'reschedule' and v_note is null then
    return jsonb_build_object('ok', false, 'error', 'Please tell us which days or times work better for you.');
  end if;

  select * into v_link from public.response_links where token = p_token for update;
  if v_link.id is null then
    return jsonb_build_object('ok', false, 'error', 'This link is not valid.');
  end if;
  if v_link.revoked_at is not null then
    return jsonb_build_object('ok', false, 'error', 'This link has been replaced. Please use the most recent message from us.');
  end if;
  if v_link.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'This link has expired. Please message us directly.');
  end if;

  select * into v_appt from public.appointments where id = v_link.appointment_id for update;
  if v_appt.starts_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'This session has already started, so it can no longer be changed online.');
  end if;
  if not (public.appointment_is_active(v_appt.status) or v_appt.status = 'declined') then
    return jsonb_build_object('ok', false, 'error', 'This appointment can no longer be changed online. Please message us directly.');
  end if;

  v_target := case p_action when 'confirm' then 'confirmed' when 'decline' then 'declined' else 'reschedule_requested' end;

  update public.response_links set last_used_at = now() where id = v_link.id;

  if v_appt.status = v_target and v_appt.student_note is not distinct from v_note then
    return jsonb_build_object('ok', true, 'status', v_target, 'unchanged', true);
  end if;

  perform set_config('app.actor_type', 'student', true);

  begin
    update public.appointments
    set status = v_target,
        student_note = v_note,
        responded_at = now()
    where id = v_appt.id;
  exception when exclusion_violation then
    return jsonb_build_object('ok', false, 'error', 'This time slot has been taken in the meantime. Please message us to pick another time.');
  end;

  if v_appt.status = v_target then
    insert into public.appointment_events (org_id, appointment_id, event_type, actor_type, actor_name, details)
    values (v_appt.org_id, v_appt.id, 'student_note_updated', 'student', 'Student', jsonb_build_object('student_note', v_note));
  end if;

  perform set_config('app.actor_type', '', true);
  return jsonb_build_object('ok', true, 'status', v_target, 'appointment_id', v_appt.id);
end;
$$;

create or replace function public.dashboard_summary(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org public.organizations%rowtype;
  v_today_start timestamptz;
  v_today_end timestamptz;
begin
  if not public.is_org_member(p_org) then
    raise exception 'You do not have access to this organization.' using errcode = '42501';
  end if;
  select * into v_org from public.organizations where id = p_org;
  v_today_start := ((now() at time zone v_org.timezone)::date)::timestamp at time zone v_org.timezone;
  v_today_end := v_today_start + interval '1 day';

  return jsonb_build_object(
    'today', (select count(*) from public.appointments where org_id = p_org and starts_at >= v_today_start and starts_at < v_today_end and status not in ('cancelled', 'rescheduled', 'declined')),
    'to_contact', (select count(*) from public.appointments where org_id = p_org and status = 'scheduled' and starts_at > now()),
    'awaiting', (select count(*) from public.appointments where org_id = p_org and status = 'awaiting_response' and starts_at > now()),
    'awaiting_overdue', (select count(*) from public.appointments where org_id = p_org and status = 'awaiting_response' and starts_at > now()
                          and coalesce(contacted_at, created_at) < now() - make_interval(hours => v_org.follow_up_after_hours)),
    'reschedule_requests', (select count(*) from public.appointments where org_id = p_org and status = 'reschedule_requested'),
    'declined_upcoming', (select count(*) from public.appointments where org_id = p_org and status = 'declined' and starts_at > now()),
    'to_close', (select count(*) from public.appointments where org_id = p_org and ends_at < now() and status in ('confirmed', 'awaiting_response', 'scheduled')),
    'failed_notifications', (select count(*) from public.notifications where org_id = p_org and status in ('failed', 'dead')),
    'confirmed_week', (select count(*) from public.appointments where org_id = p_org and status = 'confirmed' and starts_at >= now() and starts_at < now() + interval '7 days'),
    'worker_last_run', (select value->>'at' from public.system_status where key = 'notification_worker')
  );
end;
$$;

create or replace function public.org_report(p_org uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.has_org_role(p_org, array['admin', 'agent']) then
    raise exception 'Only admins and agents can view reports.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'total', count(*) filter (where status <> 'rescheduled'),
        'confirmed', count(*) filter (where status = 'confirmed'),
        'completed', count(*) filter (where status = 'completed'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'declined', count(*) filter (where status = 'declined'),
        'no_show', count(*) filter (where status = 'no_show'),
        'rescheduled', count(*) filter (where status = 'rescheduled'),
        'responded', count(*) filter (where responded_at is not null),
        'contacted', count(*) filter (where contacted_at is not null),
        'hours_delivered', round(coalesce(sum(extract(epoch from ends_at - starts_at)) filter (where status = 'completed'), 0) / 3600.0, 1)
      )
      from public.appointments where org_id = p_org and starts_at >= p_from and starts_at < p_to
    ),
    'by_coach', coalesce((
      select jsonb_agg(row_to_json(x) order by x.hours desc)
      from (
        select c.full_name as name,
          count(a.*) filter (where a.status in ('confirmed', 'completed', 'no_show')) as sessions,
          round(coalesce(sum(extract(epoch from a.ends_at - a.starts_at)) filter (where a.status in ('confirmed', 'completed')), 0) / 3600.0, 1) as hours,
          count(a.*) filter (where a.status = 'cancelled') as cancelled,
          count(a.*) filter (where a.status = 'no_show') as no_shows
        from public.coaches c
        left join public.appointments a on a.coach_id = c.id and a.starts_at >= p_from and a.starts_at < p_to
        where c.org_id = p_org
        group by c.id, c.full_name
      ) x
    ), '[]'::jsonb),
    'by_agent', coalesce((
      select jsonb_agg(row_to_json(x) order by x.created desc)
      from (
        select coalesce(nullif(m.full_name, ''), m.email) as name,
          count(a.*) as created,
          count(a.*) filter (where a.status in ('confirmed', 'completed')) as confirmed,
          count(a.*) filter (where a.contacted_at is not null) as contacted
        from public.memberships m
        left join public.appointments a on a.assigned_agent_id = m.id and a.starts_at >= p_from and a.starts_at < p_to
        where m.org_id = p_org and m.role in ('admin', 'agent')
        group by m.id, m.full_name, m.email
      ) x
    ), '[]'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(row_to_json(x) order by x.day)
      from (
        select (a.starts_at at time zone o.timezone)::date as day,
          count(*) filter (where a.status <> 'rescheduled') as booked,
          count(*) filter (where a.status in ('cancelled', 'declined')) as lost
        from public.appointments a join public.organizations o on o.id = a.org_id
        where a.org_id = p_org and a.starts_at >= p_from and a.starts_at < p_to
        group by 1
      ) x
    ), '[]'::jsonb),
    'notifications', (
      select jsonb_build_object(
        'sent', count(*) filter (where status = 'sent'),
        'failed', count(*) filter (where status in ('failed', 'dead')),
        'skipped', count(*) filter (where status = 'skipped'))
      from public.notifications where org_id = p_org and created_at >= p_from and created_at < p_to
    )
  );
end;
$$;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.venues enable row level security;
alter table public.courts enable row level security;
alter table public.coaches enable row level security;
alter table public.coach_availability enable row level security;
alter table public.blocked_times enable row level security;
alter table public.session_types enable row level security;
alter table public.students enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_events enable row level security;
alter table public.response_links enable row level security;
alter table public.message_templates enable row level security;
alter table public.notifications enable row level security;
alter table public.system_status enable row level security;
alter table public.saved_views enable row level security;

create or replace function public.is_coach_of_appointment(p_appointment uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.appointments a
    join public.coaches c on c.id = a.coach_id
    where a.id = p_appointment and c.user_id = auth.uid()
  );
$$;

create or replace function public.coach_can_see_student(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.appointments a
    join public.coaches c on c.id = a.coach_id
    where a.student_id = p_student and c.user_id = auth.uid()
  );
$$;

create policy org_select on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy org_update on public.organizations for update to authenticated
  using (public.has_org_role(id, array['admin'])) with check (public.has_org_role(id, array['admin']));

create policy membership_select on public.memberships for select to authenticated
  using (public.is_org_member(org_id));
create policy membership_update on public.memberships for update to authenticated
  using (public.has_org_role(org_id, array['admin']) or user_id = auth.uid())
  with check (public.has_org_role(org_id, array['admin']) or (user_id = auth.uid() and role = (select m.role from public.memberships m where m.id = memberships.id)));
create policy membership_delete on public.memberships for delete to authenticated
  using (public.has_org_role(org_id, array['admin']));

create policy invitations_admin on public.invitations for all to authenticated
  using (public.has_org_role(org_id, array['admin'])) with check (public.has_org_role(org_id, array['admin']));

create policy venues_select on public.venues for select to authenticated using (public.is_org_member(org_id));
create policy venues_write on public.venues for all to authenticated
  using (public.has_org_role(org_id, array['admin'])) with check (public.has_org_role(org_id, array['admin']));

create policy courts_select on public.courts for select to authenticated using (public.is_org_member(org_id));
create policy courts_write on public.courts for all to authenticated
  using (public.has_org_role(org_id, array['admin'])) with check (public.has_org_role(org_id, array['admin']));

create policy coaches_select on public.coaches for select to authenticated using (public.is_org_member(org_id));
create policy coaches_write on public.coaches for all to authenticated
  using (public.has_org_role(org_id, array['admin'])) with check (public.has_org_role(org_id, array['admin']));

create policy availability_select on public.coach_availability for select to authenticated using (public.is_org_member(org_id));
create policy availability_write on public.coach_availability for all to authenticated
  using (public.has_org_role(org_id, array['admin'])
         or exists (select 1 from public.coaches c where c.id = coach_id and c.user_id = auth.uid()))
  with check (public.has_org_role(org_id, array['admin'])
         or exists (select 1 from public.coaches c where c.id = coach_id and c.user_id = auth.uid() and c.org_id = coach_availability.org_id));

create policy blocked_select on public.blocked_times for select to authenticated using (public.is_org_member(org_id));
create policy blocked_write on public.blocked_times for all to authenticated
  using (public.has_org_role(org_id, array['admin', 'agent'])
         or exists (select 1 from public.coaches c where c.id = coach_id and c.user_id = auth.uid()))
  with check (public.has_org_role(org_id, array['admin', 'agent'])
         or exists (select 1 from public.coaches c where c.id = coach_id and c.user_id = auth.uid() and c.org_id = blocked_times.org_id));

create policy session_types_select on public.session_types for select to authenticated using (public.is_org_member(org_id));
create policy session_types_write on public.session_types for all to authenticated
  using (public.has_org_role(org_id, array['admin'])) with check (public.has_org_role(org_id, array['admin']));

create policy students_select on public.students for select to authenticated
  using (public.has_org_role(org_id, array['admin', 'agent']) or public.coach_can_see_student(id));
create policy students_insert on public.students for insert to authenticated
  with check (public.has_org_role(org_id, array['admin', 'agent']));
create policy students_update on public.students for update to authenticated
  using (public.has_org_role(org_id, array['admin', 'agent'])) with check (public.has_org_role(org_id, array['admin', 'agent']));
create policy students_delete on public.students for delete to authenticated
  using (public.has_org_role(org_id, array['admin']));

create policy appointments_select on public.appointments for select to authenticated
  using (public.has_org_role(org_id, array['admin', 'agent']) or public.is_coach_of_appointment(id));
create policy appointments_insert on public.appointments for insert to authenticated
  with check (public.has_org_role(org_id, array['admin', 'agent']));
create policy appointments_update on public.appointments for update to authenticated
  using (public.has_org_role(org_id, array['admin', 'agent']) or public.is_coach_of_appointment(id))
  with check (public.has_org_role(org_id, array['admin', 'agent']) or public.is_coach_of_appointment(id));

create policy events_select on public.appointment_events for select to authenticated
  using (public.has_org_role(org_id, array['admin', 'agent']) or public.is_coach_of_appointment(appointment_id));

create policy links_select on public.response_links for select to authenticated
  using (public.has_org_role(org_id, array['admin', 'agent']));
create policy links_insert on public.response_links for insert to authenticated
  with check (public.has_org_role(org_id, array['admin', 'agent'])
              and exists (select 1 from public.appointments a where a.id = appointment_id and a.org_id = response_links.org_id));
create policy links_update on public.response_links for update to authenticated
  using (public.has_org_role(org_id, array['admin', 'agent'])) with check (public.has_org_role(org_id, array['admin', 'agent']));

create policy templates_select on public.message_templates for select to authenticated using (public.is_org_member(org_id));
create policy templates_write on public.message_templates for all to authenticated
  using (public.has_org_role(org_id, array['admin'])) with check (public.has_org_role(org_id, array['admin']));

create policy notifications_select on public.notifications for select to authenticated
  using (public.has_org_role(org_id, array['admin', 'agent']));
create policy notifications_retry on public.notifications for update to authenticated
  using (public.has_org_role(org_id, array['admin', 'agent'])) with check (public.has_org_role(org_id, array['admin', 'agent']));

create policy saved_views_own on public.saved_views for all to authenticated
  using (user_id = auth.uid() and public.is_org_member(org_id))
  with check (user_id = auth.uid() and public.is_org_member(org_id));

revoke execute on function public.claim_notifications(int) from public, anon, authenticated;
revoke execute on function public.queue_due_reminders() from public, anon, authenticated;
revoke execute on function public.enqueue_notification(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.seed_organization_defaults(uuid) from public, anon, authenticated;
grant execute on function public.claim_notifications(int) to service_role;
grant execute on function public.queue_due_reminders() to service_role;

revoke execute on function public.get_response_page(text) from public;
revoke execute on function public.submit_student_response(text, text, text) from public;
grant execute on function public.get_response_page(text) to anon, authenticated, service_role;
grant execute on function public.submit_student_response(text, text, text) to anon, authenticated, service_role;

revoke execute on function public.create_organization(text, text, text, text) from public, anon;
revoke execute on function public.accept_invitations() from public, anon;
grant execute on function public.create_organization(text, text, text, text) to authenticated;
grant execute on function public.accept_invitations() to authenticated;

revoke all on public.system_status from anon, authenticated;

revoke execute on function public.slot_issues(uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid) from public, anon;
revoke execute on function public.suggest_slots(uuid, uuid, uuid, uuid, timestamptz, int, uuid, int) from public, anon;
revoke execute on function public.create_appointment(uuid, uuid, uuid, uuid, uuid, uuid, timestamp, int, uuid, text) from public, anon;
revoke execute on function public.reschedule_appointment(uuid, uuid, uuid, uuid, timestamp, int, int) from public, anon;
revoke execute on function public.change_appointment_status(uuid, text, text, int) from public, anon;
revoke execute on function public.log_appointment_event(uuid, text, jsonb) from public, anon;
revoke execute on function public.dashboard_summary(uuid) from public, anon;
revoke execute on function public.org_report(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.restore_default_templates(uuid) from public, anon;
revoke execute on function public.current_actor_name(uuid) from public, anon;
grant execute on function public.slot_issues(uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid) to authenticated;
grant execute on function public.suggest_slots(uuid, uuid, uuid, uuid, timestamptz, int, uuid, int) to authenticated;
grant execute on function public.create_appointment(uuid, uuid, uuid, uuid, uuid, uuid, timestamp, int, uuid, text) to authenticated;
grant execute on function public.reschedule_appointment(uuid, uuid, uuid, uuid, timestamp, int, int) to authenticated;
grant execute on function public.change_appointment_status(uuid, text, text, int) to authenticated;
grant execute on function public.log_appointment_event(uuid, text, jsonb) to authenticated;
grant execute on function public.dashboard_summary(uuid) to authenticated;
grant execute on function public.org_report(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.restore_default_templates(uuid) to authenticated;
grant execute on function public.current_actor_name(uuid) to authenticated;
