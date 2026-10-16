alter table public.organizations
  add column if not exists office_name text,
  add column if not exists office_phone text check (office_phone is null or office_phone ~ '^[0-9]{7,15}$');

alter table public.appointments
  add column if not exists office_contacted_at timestamptz,
  add column if not exists student_informed_at timestamptz,
  add column if not exists office_note text;

update public.appointments
set student_informed_at = coalesce(responded_at, updated_at)
where status = 'confirmed' and student_informed_at is null;

alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments add constraint appointments_status_check check (status in (
  'scheduled', 'awaiting_response', 'pending_approval', 'confirmed', 'not_approved', 'reschedule_requested',
  'declined', 'cancelled', 'rescheduled', 'completed', 'no_show'
));

create or replace function public.appointment_is_active(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status in ('scheduled', 'awaiting_response', 'pending_approval', 'confirmed', 'reschedule_requested');
$$;

alter table public.appointments drop constraint if exists appointments_no_coach_overlap;
alter table public.appointments drop constraint if exists appointments_no_court_overlap;

alter table public.appointments
  add constraint appointments_no_coach_overlap
  exclude using gist (coach_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
  where (status in ('scheduled', 'awaiting_response', 'pending_approval', 'confirmed', 'reschedule_requested'));

alter table public.appointments
  add constraint appointments_no_court_overlap
  exclude using gist (court_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
  where (court_id is not null and status in ('scheduled', 'awaiting_response', 'pending_approval', 'confirmed', 'reschedule_requested'));

create or replace function public.appointment_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select p_from = p_to or case p_from
    when 'scheduled' then p_to in ('awaiting_response', 'pending_approval', 'confirmed', 'not_approved', 'declined', 'reschedule_requested', 'cancelled', 'rescheduled', 'completed', 'no_show')
    when 'awaiting_response' then p_to in ('scheduled', 'pending_approval', 'confirmed', 'not_approved', 'declined', 'reschedule_requested', 'cancelled', 'rescheduled', 'completed', 'no_show')
    when 'pending_approval' then p_to in ('awaiting_response', 'confirmed', 'not_approved', 'declined', 'reschedule_requested', 'cancelled', 'rescheduled', 'completed', 'no_show')
    when 'confirmed' then p_to in ('awaiting_response', 'pending_approval', 'not_approved', 'declined', 'reschedule_requested', 'cancelled', 'rescheduled', 'completed', 'no_show')
    when 'not_approved' then p_to in ('scheduled', 'pending_approval', 'confirmed', 'cancelled', 'rescheduled')
    when 'reschedule_requested' then p_to in ('awaiting_response', 'pending_approval', 'confirmed', 'not_approved', 'declined', 'cancelled', 'rescheduled')
    when 'declined' then p_to in ('scheduled', 'awaiting_response', 'pending_approval', 'confirmed', 'reschedule_requested', 'cancelled', 'rescheduled')
    when 'cancelled' then p_to in ('scheduled')
    when 'completed' then p_to in ('no_show')
    when 'no_show' then p_to in ('completed')
    else false
  end;
$$;

create or replace function public.appointments_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_court_venue uuid;
  v_is_staff boolean;
  v_coach_user uuid;
begin
  if new.court_id is not null then
    select venue_id into v_court_venue from public.courts where id = new.court_id;
    if v_court_venue is distinct from new.venue_id then
      raise exception 'The selected court does not belong to the selected venue.'
        using errcode = 'P0001', hint = 'court_venue_mismatch';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.reference is null or new.reference = '' then
      new.reference := 'TN-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    end if;
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if not public.appointment_transition_allowed(old.status, new.status) then
    raise exception 'An appointment cannot move from "%" to "%".', old.status, new.status
      using errcode = 'P0001', hint = 'invalid_status_transition';
  end if;

  if auth.uid() is not null then
    v_is_staff := public.has_org_role(new.org_id, array['admin', 'agent']);
    if not v_is_staff then
      select user_id into v_coach_user from public.coaches where id = old.coach_id;
      if v_coach_user is distinct from auth.uid() then
        raise exception 'You do not have permission to change this appointment.'
          using errcode = '42501';
      end if;
      if new.student_id is distinct from old.student_id
        or new.coach_id is distinct from old.coach_id
        or new.venue_id is distinct from old.venue_id
        or new.court_id is distinct from old.court_id
        or new.starts_at is distinct from old.starts_at
        or new.ends_at is distinct from old.ends_at
        or new.assigned_agent_id is distinct from old.assigned_agent_id
        or (new.status is distinct from old.status
            and not (new.status in ('completed', 'no_show')
                     or (old.status = 'pending_approval' and new.status in ('confirmed', 'not_approved'))
                     or (old.status in ('confirmed', 'not_approved') and new.status in ('confirmed', 'not_approved')))) then
        raise exception 'Coaches can record the office decision, mark attendance and edit notes.'
          using errcode = '42501';
      end if;
    end if;
  end if;

  if new.status = 'pending_approval' and old.status is distinct from 'pending_approval' then
    new.office_contacted_at := null;
    new.office_note := null;
  end if;
  if new.status in ('confirmed', 'not_approved') and new.status is distinct from old.status then
    new.student_informed_at := null;
  end if;

  new.reference := old.reference;
  new.org_id := old.org_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

create or replace function public.appointments_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_type text := public.current_actor_type();
  v_actor_name text := public.current_actor_name(new.org_id);
  v_changes jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.appointment_events (org_id, appointment_id, event_type, actor_type, actor_user_id, actor_name, details)
    values (new.org_id, new.id, case when new.rescheduled_from_id is null then 'created' else 'created_by_reschedule' end,
            v_actor_type, auth.uid(), v_actor_name,
            jsonb_build_object('status', new.status, 'starts_at', new.starts_at, 'ends_at', new.ends_at,
                               'rescheduled_from_id', new.rescheduled_from_id));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.appointment_events (org_id, appointment_id, event_type, actor_type, actor_user_id, actor_name, details)
    values (new.org_id, new.id, 'status_changed', v_actor_type, auth.uid(), v_actor_name,
            jsonb_strip_nulls(jsonb_build_object(
              'from', old.status, 'to', new.status,
              'student_note', case when v_actor_type = 'student' then new.student_note end,
              'office_note', case when new.status in ('confirmed', 'not_approved') then new.office_note end,
              'reason', case when new.status = 'cancelled' then new.cancellation_reason end)));
  end if;

  if new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then
    v_changes := v_changes || jsonb_build_object('time', jsonb_build_object(
      'from', jsonb_build_array(old.starts_at, old.ends_at), 'to', jsonb_build_array(new.starts_at, new.ends_at)));
  end if;
  if new.coach_id is distinct from old.coach_id then
    v_changes := v_changes || jsonb_build_object('coach_id', jsonb_build_object('from', old.coach_id, 'to', new.coach_id));
  end if;
  if new.venue_id is distinct from old.venue_id or new.court_id is distinct from old.court_id then
    v_changes := v_changes || jsonb_build_object('location', jsonb_build_object(
      'from', jsonb_build_array(old.venue_id, old.court_id), 'to', jsonb_build_array(new.venue_id, new.court_id)));
  end if;
  if new.assigned_agent_id is distinct from old.assigned_agent_id then
    v_changes := v_changes || jsonb_build_object('agent', jsonb_build_object('from', old.assigned_agent_id, 'to', new.assigned_agent_id));
  end if;
  if new.session_type_id is distinct from old.session_type_id then
    v_changes := v_changes || jsonb_build_object('session_type', jsonb_build_object('from', old.session_type_id, 'to', new.session_type_id));
  end if;
  if new.notes is distinct from old.notes then
    v_changes := v_changes || jsonb_build_object('notes', true);
  end if;

  if v_changes <> '{}'::jsonb then
    insert into public.appointment_events (org_id, appointment_id, event_type, actor_type, actor_user_id, actor_name, details)
    values (new.org_id, new.id, 'details_changed', v_actor_type, auth.uid(), v_actor_name, v_changes);
  end if;

  return new;
end;
$$;

create or replace function public.appointment_events_enqueue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations%rowtype;
  v_to text;
  v_key text := new.id::text;
begin
  select * into v_org from public.organizations where id = new.org_id;

  if new.event_type = 'status_changed' then
    v_to := new.details->>'to';

    if v_to = 'confirmed' and v_org.notify_student_email then
      perform public.enqueue_notification(new.org_id, new.appointment_id, new.id, 'student_confirmed', 'student', v_key || ':student');
    end if;

    if v_to = 'not_approved' and v_org.notify_student_email then
      perform public.enqueue_notification(new.org_id, new.appointment_id, new.id, 'student_not_approved', 'student', v_key || ':student');
    end if;

    if v_to = 'cancelled' and new.actor_type <> 'student' and v_org.notify_student_email then
      perform public.enqueue_notification(new.org_id, new.appointment_id, new.id, 'student_cancelled', 'student', v_key || ':student');
    end if;

    if new.actor_type = 'student' and v_to in ('pending_approval', 'confirmed', 'declined', 'reschedule_requested') then
      if v_org.notify_coach_email then
        perform public.enqueue_notification(new.org_id, new.appointment_id, new.id, 'staff_student_response', 'coach', v_key || ':coach');
      end if;
      if v_org.notify_agent_email then
        perform public.enqueue_notification(new.org_id, new.appointment_id, new.id, 'staff_student_response', 'agent', v_key || ':agent');
      end if;
    end if;

    if v_to = 'cancelled' and v_org.notify_coach_email then
      perform public.enqueue_notification(new.org_id, new.appointment_id, new.id, 'staff_cancelled', 'coach', v_key || ':coach');
    end if;
  elsif new.event_type = 'created_by_reschedule' then
    if v_org.notify_student_email then
      perform public.enqueue_notification(new.org_id, new.appointment_id, new.id, 'student_rescheduled', 'student', v_key || ':student');
    end if;
    if v_org.notify_coach_email then
      perform public.enqueue_notification(new.org_id, new.appointment_id, new.id, 'staff_rescheduled', 'coach', v_key || ':coach');
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.record_office_decision(
  p_appointment uuid,
  p_decision text,
  p_note text default null,
  p_expected_version int default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old public.appointments%rowtype;
begin
  if p_decision not in ('approved', 'not_approved') then
    raise exception 'Choose whether the office approved the booking.' using errcode = 'P0001';
  end if;
  select * into v_old from public.appointments where id = p_appointment for update;
  if v_old.id is null then
    raise exception 'Appointment not found.' using errcode = 'P0002';
  end if;
  if p_expected_version is not null and v_old.version <> p_expected_version then
    raise exception 'Someone else changed this appointment a moment ago. Please reload and try again.'
      using errcode = 'P0001', hint = 'stale_version';
  end if;

  update public.appointments
  set office_note = nullif(btrim(coalesce(p_note, '')), ''),
      status = case p_decision when 'approved' then 'confirmed' else 'not_approved' end
  where id = p_appointment;

  if not found then
    raise exception 'You do not have permission to change this appointment.' using errcode = '42501';
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
  v_status text;
begin
  if p_event_type not in ('whatsapp_opened', 'whatsapp_marked_sent', 'link_copied', 'link_regenerated', 'note',
                          'calendar_downloaded', 'office_message_opened', 'office_messaged') then
    raise exception 'Unknown event type.' using errcode = 'P0001';
  end if;
  select org_id, status into v_org, v_status from public.appointments where id = p_appointment;
  if v_org is null or not public.has_org_role(v_org, array['admin', 'agent', 'coach']) then
    raise exception 'You do not have access to this appointment.' using errcode = '42501';
  end if;
  if not public.has_org_role(v_org, array['admin', 'agent'])
     and not exists (select 1 from public.appointments a join public.coaches c on c.id = a.coach_id
                     where a.id = p_appointment and c.user_id = auth.uid()) then
    raise exception 'You do not have access to this appointment.' using errcode = '42501';
  end if;

  insert into public.appointment_events (org_id, appointment_id, event_type, actor_type, actor_user_id, actor_name, details)
  values (v_org, p_appointment, p_event_type, 'staff', auth.uid(), public.current_actor_name(v_org), coalesce(p_details, '{}'::jsonb));

  if p_event_type = 'office_messaged' then
    update public.appointments set office_contacted_at = now() where id = p_appointment;
  elsif p_event_type = 'whatsapp_marked_sent' then
    if v_status in ('confirmed', 'not_approved') then
      update public.appointments set student_informed_at = now() where id = p_appointment;
    else
      update public.appointments
      set contacted_at = now(),
          status = case when status = 'scheduled' then 'awaiting_response' else status end
      where id = p_appointment;
    end if;
  end if;
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

  update public.response_links set last_used_at = now() where id = v_link.id;

  if p_action = 'confirm' and v_appt.status in ('pending_approval', 'confirmed') then
    return jsonb_build_object('ok', true, 'status', v_appt.status, 'unchanged', true);
  end if;

  v_target := case p_action when 'confirm' then 'pending_approval' when 'decline' then 'declined' else 'reschedule_requested' end;

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
    'today', (select count(*) from public.appointments where org_id = p_org and starts_at >= v_today_start and starts_at < v_today_end and status not in ('cancelled', 'rescheduled', 'declined', 'not_approved')),
    'to_contact', (select count(*) from public.appointments where org_id = p_org and status = 'scheduled' and starts_at > now()),
    'awaiting', (select count(*) from public.appointments where org_id = p_org and status = 'awaiting_response' and starts_at > now()),
    'awaiting_overdue', (select count(*) from public.appointments where org_id = p_org and status = 'awaiting_response' and starts_at > now()
                          and coalesce(contacted_at, created_at) < now() - make_interval(hours => v_org.follow_up_after_hours)),
    'office_pending', (select count(*) from public.appointments where org_id = p_org and status = 'pending_approval' and starts_at > now()),
    'office_not_sent', (select count(*) from public.appointments where org_id = p_org and status = 'pending_approval' and starts_at > now() and office_contacted_at is null),
    'results_to_send', (select count(*) from public.appointments where org_id = p_org and status in ('confirmed', 'not_approved') and starts_at > now() and student_informed_at is null),
    'reschedule_requests', (select count(*) from public.appointments where org_id = p_org and status = 'reschedule_requested'),
    'declined_upcoming', (select count(*) from public.appointments where org_id = p_org and status = 'declined' and starts_at > now()),
    'to_close', (select count(*) from public.appointments where org_id = p_org and ends_at < now() and status in ('confirmed', 'pending_approval', 'awaiting_response', 'scheduled')),
    'failed_notifications', (select count(*) from public.notifications where org_id = p_org and status in ('failed', 'dead')),
    'confirmed_week', (select count(*) from public.appointments where org_id = p_org and status = 'confirmed' and starts_at >= now() and starts_at < now() + interval '7 days'),
    'worker_last_run', (select value->>'at' from public.system_status where key = 'notification_worker')
  );
end;
$$;

create or replace function public.seed_office_templates(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.message_templates (org_id, key, channel, name, subject, body) values
  (p_org, 'office_request', 'whatsapp', 'To the office: please approve', null,
'Hi {{office_name}}, this is {{agent_name}} from {{org_name}}.

A student has confirmed a session. Can you please approve it?

👤 {{student_name}}
📅 {{date}}
⏰ {{time}} ({{duration}})
📍 {{venue}}{{court_line}}
🎾 {{session_type}} with Coach {{coach}}
Ref: {{reference}}

Thank you!'),
  (p_org, 'office_approved', 'whatsapp', 'To student: office approved', null,
'Hi {{student_first_name}}! Good news — your tennis session is officially confirmed ✅

📅 {{date}}
⏰ {{time}} ({{duration}})
📍 {{venue}}{{court_line}}
👤 Coach {{coach}}

See you on court! 🎾'),
  (p_org, 'office_not_approved', 'whatsapp', 'To student: office did not approve', null,
'Hi {{student_first_name}}, we''re sorry — the club couldn''t confirm your session on {{date}} at {{time}}.
{{office_note_line}}
We''d love to find you another time. Just reply with the days and times that work for you.'),
  (p_org, 'student_not_approved', 'email', 'Student: office did not approve',
'About your session on {{date}}',
'Hi {{student_first_name}},

We''re sorry — the club couldn''t confirm your {{session_type}} on {{date}} at {{time}}.
{{office_note_line}}
Reply to this email or message us on WhatsApp and we''ll find you another time.

{{org_name}}')
  on conflict (org_id, channel, key) do nothing;
end;
$$;

create or replace function public.organizations_seed_office_templates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_office_templates(new.id);
  return new;
end;
$$;

drop trigger if exists organizations_seed_office_templates on public.organizations;
create trigger organizations_seed_office_templates
after insert on public.organizations
for each row execute function public.organizations_seed_office_templates();

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
  perform public.seed_office_templates(p_org);
end;
$$;

select public.seed_office_templates(id) from public.organizations;

update public.message_templates
set body = replace(body, '{{student_name}} has responded: {{status_label}}.', '{{student_name}} has responded: {{status_label}}.
{{office_hint}}')
where key = 'staff_student_response' and channel = 'email' and body not like '%{{office_hint}}%';

revoke execute on function public.seed_office_templates(uuid) from public, anon, authenticated;
revoke execute on function public.record_office_decision(uuid, text, text, int) from public, anon;
grant execute on function public.record_office_decision(uuid, text, text, int) to authenticated;
