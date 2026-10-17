alter table public.courts
  add column if not exists alt_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'courts_alt_name_length') then
    alter table public.courts
      add constraint courts_alt_name_length check (alt_name is null or char_length(btrim(alt_name)) between 1 and 60);
  end if;
end $$;

alter table public.students
  add column if not exists is_regular boolean not null default false;

update public.students
set is_regular = true
where is_regular = false
  and exists (
    select 1 from public.appointments a
    where a.student_id = students.id and a.import_batch is not null
  );
