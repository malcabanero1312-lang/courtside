delete from public.office_request_items;
delete from public.office_requests;
delete from public.monthly_confirmations;
delete from public.regular_slots;
delete from public.appointments;
delete from public.students
where notes = 'Added from the office court sheet'
  and phone is null
  and email is null;
