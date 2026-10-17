create table if not exists public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  coach_id uuid references public.coaches(id) on delete cascade,
  token text not null unique check (char_length(token) >= 24),
  created_at timestamptz not null default now(),
  last_fetched_at timestamptz
);

create index if not exists calendar_feeds_member_idx on public.calendar_feeds(membership_id);

alter table public.calendar_feeds enable row level security;

drop policy if exists calendar_feeds_own on public.calendar_feeds;
create policy calendar_feeds_own on public.calendar_feeds for all to authenticated
  using (exists (select 1 from public.memberships m where m.id = membership_id and m.user_id = auth.uid()))
  with check (
    exists (select 1 from public.memberships m where m.id = membership_id and m.user_id = auth.uid() and m.org_id = calendar_feeds.org_id)
  );

grant select, insert, update, delete on public.calendar_feeds to authenticated;

alter table public.coaches
  add column if not exists sheet_names text[] not null default '{}';

create or replace function public.calendar_feed_events(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
  v_role text;
  v_coach uuid;
  v_events jsonb;
begin
  if p_token is null or char_length(p_token) < 24 or char_length(p_token) > 128 then
    return jsonb_build_object('found', false);
  end if;
  select cf.*, m.role, m.user_id into f
  from public.calendar_feeds cf
  join public.memberships m on m.id = cf.membership_id
  where cf.token = p_token;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  v_coach := f.coach_id;
  if f.role = 'coach' then
    select c.id into v_coach from public.coaches c where c.org_id = f.org_id and c.user_id = f.user_id limit 1;
    if v_coach is null then
      return jsonb_build_object('found', true, 'events', '[]'::jsonb, 'org_name', (select name from public.organizations where id = f.org_id));
    end if;
  end if;

  update public.calendar_feeds set last_fetched_at = now() where id = f.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'share_group', a.share_group,
      'starts_at', a.starts_at,
      'ends_at', a.ends_at,
      'status', a.status,
      'reference', a.reference,
      'updated_at', a.updated_at,
      'version', a.version,
      'student', s.full_name,
      'coach', c.full_name,
      'venue', v.name,
      'venue_address', v.address,
      'court', ct.name
    ) order by a.starts_at), '[]'::jsonb)
  into v_events
  from public.appointments a
  join public.students s on s.id = a.student_id
  join public.coaches c on c.id = a.coach_id
  join public.venues v on v.id = a.venue_id
  left join public.courts ct on ct.id = a.court_id
  where a.org_id = f.org_id
    and (v_coach is null or a.coach_id = v_coach)
    and a.status in ('scheduled', 'awaiting_response', 'pending_approval', 'confirmed', 'reschedule_requested', 'completed', 'no_show')
    and a.starts_at >= now() - interval '60 days'
    and a.starts_at < now() + interval '400 days';

  return jsonb_build_object(
    'found', true,
    'events', v_events,
    'org_name', (select name from public.organizations where id = f.org_id),
    'coach_name', (select full_name from public.coaches where id = v_coach)
  );
end;
$$;

grant execute on function public.calendar_feed_events(text) to anon, authenticated;
