alter table public.response_links
  add column if not exists responded_at timestamptz;

update public.response_links l
set responded_at = coalesce(l.last_used_at, a.responded_at)
from public.appointments a
where a.id = l.appointment_id
  and l.responded_at is null
  and a.responded_at is not null
  and l.last_used_at is not null;

alter table public.organizations
  add column if not exists contact_phone text check (contact_phone is null or contact_phone ~ '^[0-9]{7,15}$');

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
         o.brand_color, o.cancellation_policy, o.contact_phone
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
    when r.starts_at <= now() then 'past'
    when not public.appointment_is_active(r.status) and r.status <> 'declined' then 'closed'
    when v_link.responded_at is not null then 'answered'
    when v_link.expires_at < now() then 'expired'
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
    'contact_phone', r.contact_phone,
    'student_note', r.student_note,
    'responded_at', coalesce(v_link.responded_at, r.responded_at)
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

  v_target := case p_action when 'confirm' then 'pending_approval' when 'decline' then 'declined' else 'reschedule_requested' end;
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

  update public.response_links set responded_at = now(), last_used_at = now() where id = v_link.id;

  perform set_config('app.actor_type', '', true);
  return jsonb_build_object('ok', true, 'status', v_target, 'appointment_id', v_appt.id);
end;
$$;
