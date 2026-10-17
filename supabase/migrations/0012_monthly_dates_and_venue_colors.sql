alter table public.venues
  add column if not exists color text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'venues_color_hex') then
    alter table public.venues add constraint venues_color_hex check (color is null or color ~ '^#[0-9a-fA-F]{6}$');
  end if;
end $$;

alter table public.regular_slots
  add column if not exists venue_id uuid references public.venues(id) on delete set null;

alter table public.monthly_confirmations
  add column if not exists requested_entries jsonb;

drop function if exists public.respond_monthly(text, text, text);

create or replace function public.respond_monthly(p_token text, p_action text, p_note text default null, p_dates text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_entries jsonb;
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

  v_entries := r.entries;
  if p_action = 'confirm' and p_dates is not null then
    select coalesce(jsonb_agg(e order by e->>'date', e->>'start'), '[]'::jsonb)
    into v_entries
    from jsonb_array_elements(r.entries) e
    where e->>'date' = any(p_dates);
    if jsonb_array_length(v_entries) = 0 then
      return jsonb_build_object('ok', false, 'error', 'Tick at least one date, or choose “I''m not continuing this month”.');
    end if;
  end if;

  update public.monthly_confirmations
  set status = case p_action when 'confirm' then 'confirmed' when 'change' then 'change_requested' else 'declined' end,
      requested_entries = coalesce(r.requested_entries, r.entries),
      entries = v_entries,
      student_note = left(v_note, 600),
      answered_by = 'student',
      responded_at = now()
  where id = r.id;

  if p_action = 'confirm' then
    perform public.materialize_monthly(r.id);
  end if;

  return jsonb_build_object('ok', true, 'status',
    case p_action when 'confirm' then 'confirmed' when 'change' then 'change_requested' else 'declined' end,
    'confirmed', case when p_action = 'confirm' then jsonb_array_length(v_entries) else 0 end,
    'requested', jsonb_array_length(r.entries));
end;
$$;

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
  select m.status, m.entries, m.requested_entries, m.month, m.student_note, m.responded_at, m.answered_by,
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
    'requested_entries', coalesce(r.requested_entries, r.entries),
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

grant execute on function public.respond_monthly(text, text, text, text[]) to anon, authenticated;
grant execute on function public.get_monthly_page(text) to anon, authenticated;
