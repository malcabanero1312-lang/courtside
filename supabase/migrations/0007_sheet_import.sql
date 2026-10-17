alter table public.organizations
  add column if not exists confirm_days_before int not null default 2 check (confirm_days_before between 0 and 30);

alter table public.appointments
  add column if not exists office_approved boolean not null default false,
  add column if not exists message_due_at timestamptz,
  add column if not exists import_batch text;

create index if not exists appointments_message_due_idx on public.appointments(org_id, status, message_due_at);

do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.students'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%phone IS NOT NULL%email IS NOT NULL%'
  loop
    execute format('alter table public.students drop constraint %I', r.conname);
  end loop;
end $$;

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
  if v_link.responded_at is not null then
    return jsonb_build_object('ok', false, 'locked', true,
      'error', 'You have already answered. If you have any concerns, please contact us directly.');
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

  v_target := case p_action
    when 'confirm' then case when v_appt.office_approved then 'confirmed' else 'pending_approval' end
    when 'decline' then 'declined'
    else 'reschedule_requested'
  end;
  if p_action = 'confirm' and v_appt.status = 'confirmed' then
    v_target := 'confirmed';
  end if;

  perform set_config('app.actor_type', 'student', true);

  begin
    update public.appointments
    set status = v_target,
        student_note = v_note,
        responded_at = now()
    where id = v_appt.id;
  exception when exclusion_violation then
    perform set_config('app.actor_type', '', true);
    return jsonb_build_object('ok', false, 'error', 'This time slot has been taken in the meantime. Please message us to pick another time.');
  end;

  if v_appt.status = v_target then
    insert into public.appointment_events (org_id, appointment_id, event_type, actor_type, actor_name, details)
    values (v_appt.org_id, v_appt.id, 'student_note_updated', 'student', 'Student', jsonb_build_object('student_note', v_note));
  end if;

  if v_target = 'confirmed' and v_appt.office_approved then
    update public.appointments set student_informed_at = now() where id = v_appt.id;
  end if;

  update public.response_links set responded_at = now(), last_used_at = now() where id = v_link.id;

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
    'to_contact', (select count(*) from public.appointments where org_id = p_org and status = 'scheduled' and starts_at > now()
                    and (message_due_at is null or message_due_at <= now())),
    'scheduled_later', (select count(*) from public.appointments where org_id = p_org and status = 'scheduled' and starts_at > now()
                    and message_due_at > now()),
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
