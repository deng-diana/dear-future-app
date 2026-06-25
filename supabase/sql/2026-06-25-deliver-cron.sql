-- 2026-06-25 — Daily cron job: call the deliver Edge Function once a day via pg_cron + pg_net.
--
-- 背景 (Background):
--   The deliver Edge Function queries letters where delivered_at IS NULL AND deliver_on <= today,
--   emails each via Resend, and stamps delivered_at. It is fully idempotent — already-delivered
--   letters are skipped. Without this job, due letters would never be emailed automatically.
--
-- 实现方案 (How it works):
--   1. pg_cron   — Supabase's built-in Postgres cron scheduler. Runs SQL on a schedule.
--   2. pg_net    — Supabase's built-in HTTP client for Postgres. Lets SQL make outbound HTTP calls.
--   Together they let a pure-SQL row trigger an HTTP POST to our Edge Function once a day.
--
-- 部署方法 (How to apply):
--   Supabase Dashboard → SQL Editor → paste this file → Run.
--   If pg_cron / pg_net are not yet enabled, the CREATE EXTENSION lines below handle it
--   (they are safe to re-run). You can also enable them manually at:
--   Dashboard → Database → Extensions → search "pg_cron" / "pg_net" → toggle on.
--
-- 幂等性 (Idempotency):
--   This file is safe to re-run. The UNSCHEDULE step below removes any previous job of the
--   same name before re-creating it, but only if it already exists (no error if absent).


-- ─── 1. Enable required extensions (safe to re-run) ─────────────────────────

-- pg_cron  = the scheduler; lets Postgres run SQL on a cron schedule.
create extension if not exists pg_cron;

-- pg_net   = the HTTP client; lets Postgres make outbound HTTP requests.
--            On Supabase this also lives in the Dashboard → Database → Extensions list.
create extension if not exists pg_net;


-- ─── 2. Remove any previous job of the same name (idempotent) ───────────────

-- cron.unschedule errors if the job does not exist, so we guard with a WHERE EXISTS.
select cron.unschedule('deliver-due-letters')
where exists (
    select 1 from cron.job where jobname = 'deliver-due-letters'
);


-- ─── 3. Schedule the daily delivery job ─────────────────────────────────────

-- Cron expression: '0 7 * * *'
--   field 1 → 0   = minute 0
--   field 2 → 7   = hour 7 (07:00 UTC)
--   field 3 → *   = every day of the month
--   field 4 → *   = every month
--   field 5 → *   = every day of the week
-- Result: runs once a day at 07:00 UTC.
-- Why 07:00 UTC? Morning in the UK (founder's timezone). The deliver function keys off the
-- UTC date (deliver_on <= today UTC), so any single daily run on or after the due date
-- is sufficient — letters due "today" arrive in the user's inbox before they wake up.

-- Authorization header uses the PUBLIC anon (anonymous) key.
-- "anon" = anonymous — the lowest-privilege role; it is NOT the secret service_role key.
-- This key is already shipped inside the mobile app bundle (safe to commit / embed).
-- The only thing it grants here is triggering the deliver endpoint; the function itself
-- uses the service_role key (stored as a Supabase secret, never in this file) to read
-- letters and send email. An attacker who calls this endpoint with the anon key can only
-- trigger an idempotent, due-letters-only delivery — they cannot read, modify, or delete
-- any data.

select cron.schedule(
    'deliver-due-letters',   -- job name (unique identifier)
    '0 7 * * *',             -- daily at 07:00 UTC
    $$
    select net.http_post(
        url     := 'https://vxvgcozpuerrjtoxwumi.supabase.co/functions/v1/deliver',
        headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4dmdjb3pwdWVycmp0b3h3dW1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNzAyODQsImV4cCI6MjA5Njg0NjI4NH0.POL88HDZCOubSx-2b-i0HBP3CK7Sn72TZRzeKz-nuhk"}'::jsonb,
        body    := '{}'::jsonb
    );
    $$
);


-- ─── VERIFICATION QUERIES (run these after applying to confirm everything is wired up) ──

-- Query 1 — confirm the job is scheduled and active:
--
--   select jobid, jobname, schedule, active
--   from cron.job
--   where jobname = 'deliver-due-letters';
--
--   Expected: one row, schedule = '0 7 * * *', active = true.


-- Query 2 — safe manual wiring test (fire pg_net → Edge Function right now):
--
-- This is safe to run at any time because the deliver function is idempotent and
-- due-only: if there are no undelivered letters whose deliver_on <= today, it does
-- nothing and returns {"processed":0,"results":[]}. Running it will NOT re-send
-- any already-delivered letter.
--
--   select net.http_post(
--       url     := 'https://vxvgcozpuerrjtoxwumi.supabase.co/functions/v1/deliver',
--       headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4dmdjb3pwdWVycmp0b3h3dW1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNzAyODQsImV4cCI6MjA5Njg0NjI4NH0.POL88HDZCOubSx-2b-i0HBP3CK7Sn72TZRzeKz-nuhk"}'::jsonb,
--       body    := '{}'::jsonb
--   );
--
-- pg_net is asynchronous — the call above enqueues the request and returns a request_id.
-- To read the actual HTTP response (status code + body), wait a few seconds then run:
--
--   select id, status_code, content, error_msg, created
--   from net._http_response
--   order by created desc
--   limit 1;
--
--   Expected: status_code = 200, content contains "processed":0 (no due letters right now).
--   If status_code is NULL and error_msg is set, pg_net could not reach the function —
--   check that the Edge Function is deployed and the URL is correct.
