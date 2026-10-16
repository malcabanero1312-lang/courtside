create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'courtside-notifications',
  '*/10 * * * *',
  $$
  select net.http_get(
    url := 'https://YOUR-APP.vercel.app/api/cron/notifications',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR-CRON-SECRET')
  );
  $$
);
