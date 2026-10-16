create extension if not exists btree_gist with schema extensions;

create or replace function public.is_valid_timezone(p_tz text)
returns boolean
language sql
stable
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz);
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  timezone text not null default 'Asia/Manila',
  default_country_code text not null default '63' check (default_country_code ~ '^[0-9]{1,4}$'),
  default_duration_minutes int not null default 60 check (default_duration_minutes between 15 and 480),
  slot_step_minutes int not null default 30 check (slot_step_minutes in (10, 15, 20, 30, 60)),
  reminder_hours_before int not null default 24 check (reminder_hours_before between 0 and 168),
  response_link_days int not null default 14 check (response_link_days between 1 and 90),
  follow_up_after_hours int not null default 24 check (follow_up_after_hours between 1 and 168),
  brand_color text not null default '#1d5c45' check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  reply_to_email text,
  notify_student_email boolean not null default true,
  notify_coach_email boolean not null default true,
  notify_agent_email boolean not null default true,
  cancellation_policy text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_timezone_valid check (public.is_valid_timezone(timezone))
);

create trigger organizations_touch before update on public.organizations
for each row execute function public.touch_updated_at();

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'agent', 'coach')),
  full_name text not null default '',
  email text not null,
  phone text,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index memberships_user_idx on public.memberships(user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('admin', 'agent', 'coach')),
  full_name text,
  coach_id uuid,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz
);

create unique index invitations_open_unique
  on public.invitations(org_id, lower(email))
  where accepted_at is null and revoked_at is null;

create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(p_org uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role = any(p_roles)
  );
$$;

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  address text,
  maps_url text,
  opens_at time not null default '06:00',
  closes_at time not null default '22:00',
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (closes_at > opens_at),
  unique (id, org_id)
);

create index venues_org_idx on public.venues(org_id);

create table public.courts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  venue_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  surface text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (venue_id, org_id) references public.venues(id, org_id) on delete cascade,
  unique (venue_id, name),
  unique (id, org_id)
);

create index courts_venue_idx on public.courts(venue_id);

create table public.coaches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  email text,
  phone text,
  color text not null default '#1d5c45' check (color ~ '^#[0-9a-fA-F]{6}$'),
  specialties text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);

create index coaches_org_idx on public.coaches(org_id);
create unique index coaches_user_unique on public.coaches(org_id, user_id) where user_id is not null;

alter table public.invitations
  add constraint invitations_coach_fk foreign key (coach_id) references public.coaches(id) on delete set null;

create table public.coach_availability (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  coach_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  foreign key (coach_id, org_id) references public.coaches(id, org_id) on delete cascade,
  check (end_time > start_time)
);

create index coach_availability_coach_idx on public.coach_availability(coach_id, weekday);

create table public.blocked_times (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  coach_id uuid references public.coaches(id) on delete cascade,
  venue_id uuid references public.venues(id) on delete cascade,
  court_id uuid references public.courts(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (num_nonnulls(coach_id, venue_id, court_id) = 1)
);

create index blocked_times_range_idx on public.blocked_times using gist (org_id, tstzrange(starts_at, ends_at, '[)'));

create table public.session_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  duration_minutes int not null default 60 check (duration_minutes between 15 and 480),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, name),
  unique (id, org_id)
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  phone text check (phone is null or phone ~ '^[0-9]{7,15}$'),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  preferred_channel text not null default 'whatsapp' check (preferred_channel in ('whatsapp', 'email')),
  email_opt_in boolean not null default true,
  level text,
  guardian_name text,
  notes text,
  is_archived boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone is not null or email is not null),
  unique (id, org_id)
);

create index students_org_idx on public.students(org_id);
create index students_phone_idx on public.students(org_id, phone);
create index students_email_idx on public.students(org_id, lower(email));
create index students_name_idx on public.students(org_id, lower(full_name));

create trigger students_touch before update on public.students
for each row execute function public.touch_updated_at();

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  reference text not null,
  student_id uuid not null,
  coach_id uuid not null,
  venue_id uuid not null,
  court_id uuid,
  session_type_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in (
    'scheduled', 'awaiting_response', 'confirmed', 'reschedule_requested',
    'declined', 'cancelled', 'rescheduled', 'completed', 'no_show'
  )),
  assigned_agent_id uuid references public.memberships(id) on delete set null,
  notes text,
  student_note text,
  cancellation_reason text,
  rescheduled_from_id uuid references public.appointments(id) on delete set null,
  contacted_at timestamptz,
  responded_at timestamptz,
  reminder_queued_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  foreign key (student_id, org_id) references public.students(id, org_id) on delete restrict,
  foreign key (coach_id, org_id) references public.coaches(id, org_id) on delete restrict,
  foreign key (venue_id, org_id) references public.venues(id, org_id) on delete restrict,
  foreign key (court_id, org_id) references public.courts(id, org_id) on delete restrict,
  foreign key (session_type_id, org_id) references public.session_types(id, org_id) on delete restrict,
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '8 hours'),
  unique (org_id, reference)
);

alter table public.appointments
  add constraint appointments_no_coach_overlap
  exclude using gist (coach_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
  where (status in ('scheduled', 'awaiting_response', 'confirmed', 'reschedule_requested'));

alter table public.appointments
  add constraint appointments_no_court_overlap
  exclude using gist (court_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
  where (court_id is not null and status in ('scheduled', 'awaiting_response', 'confirmed', 'reschedule_requested'));

create index appointments_org_start_idx on public.appointments(org_id, starts_at);
create index appointments_org_status_idx on public.appointments(org_id, status);
create index appointments_student_idx on public.appointments(student_id, starts_at desc);
create index appointments_coach_idx on public.appointments(coach_id, starts_at);

create or replace function public.appointment_is_active(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status in ('scheduled', 'awaiting_response', 'confirmed', 'reschedule_requested');
$$;

create or replace function public.appointment_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select p_from = p_to or case p_from
    when 'scheduled' then p_to in ('awaiting_response', 'confirmed', 'declined', 'reschedule_requested', 'cancelled', 'rescheduled', 'completed', 'no_show')
    when 'awaiting_response' then p_to in ('scheduled', 'confirmed', 'declined', 'reschedule_requested', 'cancelled', 'rescheduled', 'completed', 'no_show')
    when 'confirmed' then p_to in ('awaiting_response', 'declined', 'reschedule_requested', 'cancelled', 'rescheduled', 'completed', 'no_show')
    when 'reschedule_requested' then p_to in ('awaiting_response', 'confirmed', 'declined', 'cancelled', 'rescheduled')
    when 'declined' then p_to in ('scheduled', 'awaiting_response', 'confirmed', 'reschedule_requested', 'cancelled', 'rescheduled')
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
        or (new.status is distinct from old.status and new.status not in ('completed', 'no_show')) then
        raise exception 'Coaches can only mark their sessions as completed or no-show and edit notes.'
          using errcode = '42501';
      end if;
    end if;
  end if;

  new.reference := old.reference;
  new.org_id := old.org_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger appointments_before_write
before insert or update on public.appointments
for each row execute function public.appointments_before_write();

create table public.appointment_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'staff' check (actor_type in ('staff', 'student', 'system')),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index appointment_events_appt_idx on public.appointment_events(appointment_id, created_at);
create index appointment_events_org_idx on public.appointment_events(org_id, created_at desc);

create or replace function public.current_actor_type()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.actor_type', true), ''),
    case when auth.uid() is null then 'system' else 'staff' end
  );
$$;

create or replace function public.current_actor_name(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_actor_type() = 'student' then 'Student'
    when auth.uid() is null then 'System'
    else coalesce(
      (select nullif(full_name, '') from public.memberships where org_id = p_org and user_id = auth.uid()),
      (select email from public.memberships where org_id = p_org and user_id = auth.uid()),
      'Staff'
    )
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

create trigger appointments_after_write
after insert or update on public.appointments
for each row execute function public.appointments_after_write();

create table public.response_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  token text not null unique check (char_length(token) >= 24),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index response_links_appt_idx on public.response_links(appointment_id, created_at desc);

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  channel text not null check (channel in ('whatsapp', 'email')),
  name text not null,
  subject text,
  body text not null check (char_length(body) between 1 and 4000),
  updated_at timestamptz not null default now(),
  unique (org_id, channel, key)
);

create trigger message_templates_touch before update on public.message_templates
for each row execute function public.touch_updated_at();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  event_id uuid references public.appointment_events(id) on delete set null,
  template_key text not null,
  recipient_type text not null check (recipient_type in ('student', 'coach', 'agent')),
  recipient_email text,
  subject text,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'dead', 'skipped')),
  attempts int not null default 0,
  last_error text,
  provider_message_id text,
  dedupe_key text not null unique,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_queue_idx on public.notifications(status, next_attempt_at);
create index notifications_org_idx on public.notifications(org_id, created_at desc);
create index notifications_appt_idx on public.notifications(appointment_id);

create or replace function public.enqueue_notification(
  p_org uuid, p_appointment uuid, p_event uuid, p_template text, p_recipient text, p_dedupe text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (org_id, appointment_id, event_id, template_key, recipient_type, dedupe_key)
  values (p_org, p_appointment, p_event, p_template, p_recipient, p_dedupe)
  on conflict (dedupe_key) do nothing;
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

    if v_to = 'confirmed' then
      if v_org.notify_student_email then
        perform public.enqueue_notification(new.org_id, new.appointment_id, new.id, 'student_confirmed', 'student', v_key || ':student');
      end if;
    end if;

    if v_to = 'cancelled' and new.actor_type <> 'student' then
      if v_org.notify_student_email then
        perform public.enqueue_notification(new.org_id, new.appointment_id, new.id, 'student_cancelled', 'student', v_key || ':student');
      end if;
    end if;

    if new.actor_type = 'student' and v_to in ('confirmed', 'declined', 'reschedule_requested') then
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

create trigger appointment_events_enqueue
after insert on public.appointment_events
for each row execute function public.appointment_events_enqueue();

create or replace function public.claim_notifications(p_limit int default 20)
returns setof public.notifications
language sql
security definer
set search_path = public
as $$
  update public.notifications n
  set status = 'sending', locked_at = now(), attempts = n.attempts + 1
  where n.id in (
    select id from public.notifications
    where (status in ('pending', 'failed') and next_attempt_at <= now())
       or (status = 'sending' and locked_at < now() - interval '10 minutes')
    order by next_attempt_at
    limit greatest(1, least(p_limit, 100))
    for update skip locked
  )
  returning n.*;
$$;

create or replace function public.queue_due_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select a.id, a.org_id, a.starts_at
    from public.appointments a
    join public.organizations o on o.id = a.org_id
    where a.status in ('confirmed', 'awaiting_response')
      and a.reminder_queued_at is null
      and o.reminder_hours_before > 0
      and o.notify_student_email
      and a.starts_at > now()
      and a.starts_at <= now() + make_interval(hours => o.reminder_hours_before)
    for update of a skip locked
  loop
    perform public.enqueue_notification(r.org_id, r.id, null, 'student_reminder', 'student',
      'reminder:' || r.id::text || ':' || extract(epoch from r.starts_at)::bigint::text);
    update public.appointments set reminder_queued_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create table public.system_status (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  query text not null,
  created_at timestamptz not null default now()
);

create index saved_views_user_idx on public.saved_views(user_id, org_id);
