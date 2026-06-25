-- 2026-06-25 — Per-user local-time delivery: deliver each letter at ~19:00 (7pm)
-- in the WRITER's own timezone, on their chosen day — instead of one fixed 07:00 UTC for everyone.
--
-- 背景 (Background):
--   The reunion is the product's core emotional moment. A letter that returns at 7am in someone
--   else's timezone lands at 3am for the writer — wrong. So we store the writer's IANA timezone
--   (e.g. 'Europe/London') on the letter at seal time, and deliver at 19:00 LOCAL on deliver_on.
--   Why 7pm? Evening — a quiet, reflective time, after the day's work, when there is space to read
--   a letter from your past self. (NOT 7am rush, not midnight.)
--
-- 三件事 (Three changes here):
--   1. Add a nullable `deliver_tz` column (IANA tz string). Old letters stay NULL → fall back to UTC.
--   2. A `due_letters()` SQL function that returns letters whose LOCAL 7pm has now passed.
--   3. Reschedule the cron from DAILY to HOURLY, so each timezone's 7pm is caught within an hour.
--
-- 部署方法 (How to apply):
--   Supabase Dashboard → SQL Editor → paste this file → Run. Safe to re-run (all steps idempotent).


-- ─── 1. Add the timezone column (nullable; old letters stay NULL → UTC fallback) ────

-- deliver_tz = the writer's IANA timezone at seal time, e.g. 'Europe/London', 'Pacific/Auckland'.
-- Captured client-side via Intl.DateTimeFormat().resolvedOptions().timeZone and validated server-side
-- in the seal-letter function before it ever reaches a row, so this column never holds a bad tz.
alter table public.letters add column if not exists deliver_tz text;


-- ─── 2. due_letters(): letters whose LOCAL 7pm has now passed and aren't delivered yet ──

-- The timezone math (read carefully — this is the whole feature):
--   • deliver_on is a `date` (e.g. 2026-07-01).
--   • `deliver_on + interval '19 hours'` → a timestamp WITHOUT timezone = 19:00 wall-clock
--     on that date (2026-07-01 19:00). It carries no zone yet — just "7pm on the dial".
--   • `... at time zone <tz>` INTERPRETS that wall-clock time as local to <tz> and returns the
--     `timestamptz` — the exact UTC instant when it is 7pm in <tz> on that day. Postgres applies
--     the correct UTC offset for that date, so DST (daylight saving) is handled automatically:
--     a July letter and a January letter in 'Europe/London' get +01:00 and +00:00 respectively.
--   • Compare `<= now()`: if that local-7pm instant has already arrived, the letter is due.
--   • coalesce(nullif(deliver_tz,''), 'UTC'): NULL or empty tz → 'UTC' (old letters: UTC 7pm).
--     This fallback also keeps `at time zone` from ever receiving NULL (which would yield NULL,
--     making the row silently never-due) or '' (which raises an error).
-- Returns full `letters` rows, so the deliver function still gets id, owner_id, body, deliver_on,
-- reveal_token, sealed_at — every field it already uses.
create or replace function public.due_letters()
returns setof public.letters
language sql
stable
as $$
  select *
  from public.letters
  where delivered_at is null
    and ((deliver_on + interval '19 hours')
          at time zone coalesce(nullif(deliver_tz, ''), 'UTC')) <= now();
$$;


-- ─── 3. Reschedule the delivery cron from DAILY to HOURLY ───────────────────────────

-- This SUPERSEDES the daily '0 7 * * *' schedule in 2026-06-25-deliver-cron.sql.
-- Why hourly? Per-user local 7pm spans all 24 hours of UTC across the globe. A once-a-day run
-- would deliver everyone at the same UTC moment again — defeating the whole point. Running every
-- hour means each timezone's 7pm instant is picked up within 60 minutes of arriving.
-- Why this is safe to run hourly: the deliver function is idempotent — it stamps delivered_at
-- after sending, and due_letters() filters out anything already stamped, so re-runs never
-- double-send. An hour with no newly-due letters just returns {"processed":0,...} and does nothing.

-- cron.unschedule errors if the job is absent, so guard with WHERE EXISTS (idempotent).
select cron.unschedule('deliver-due-letters')
where exists (
    select 1 from cron.job where jobname = 'deliver-due-letters'
);

-- Cron expression '0 * * * *' = minute 0 of every hour, every day. (Was '0 7 * * *' = daily 07:00.)
-- The net.http_post below is copied verbatim from 2026-06-25-deliver-cron.sql (same URL, same
-- public anon key, same empty body) — only the SCHEDULE changed. The anon key is the low-privilege
-- public key already shipped in the app bundle; it can only trigger the idempotent deliver endpoint.
select cron.schedule(
    'deliver-due-letters',   -- job name (unique identifier)
    '0 * * * *',             -- hourly, at minute 0 of every hour (UTC)
    $$
    select net.http_post(
        url     := 'https://vxvgcozpuerrjtoxwumi.supabase.co/functions/v1/deliver',
        headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4dmdjb3pwdWVycmp0b3h3dW1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNzAyODQsImV4cCI6MjA5Njg0NjI4NH0.POL88HDZCOubSx-2b-i0HBP3CK7Sn72TZRzeKz-nuhk"}'::jsonb,
        body    := '{}'::jsonb
    );
    $$
);


-- ─── VERIFICATION QUERIES (run after applying to confirm everything is wired up) ────

-- Query 1 — confirm the deliver_tz column exists:
--
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'letters' and column_name = 'deliver_tz';
--
--   Expected: one row, data_type = 'text', is_nullable = 'YES'.

-- Query 2 — confirm the due_letters() function exists:
--
--   select proname, pronargs
--   from pg_proc
--   where proname = 'due_letters' and pronamespace = 'public'::regnamespace;
--
--   Expected: one row, proname = 'due_letters', pronargs = 0.

-- Query 3 — confirm the cron is now HOURLY:
--
--   select jobid, jobname, schedule, active
--   from cron.job
--   where jobname = 'deliver-due-letters';
--
--   Expected: one row, schedule = '0 * * * *', active = true.

-- Query 4 (optional) — sanity-check the local-7pm math for a few timezones:
--
--   (parens required: AT TIME ZONE binds tighter than +, so the date+interval must be grouped)
--   select ('2026-07-01'::date + interval '19 hours') at time zone 'Pacific/Auckland' as auckland_7pm_utc,
--          ('2026-07-01'::date + interval '19 hours') at time zone 'Europe/London'     as london_7pm_utc,
--          ('2026-07-01'::date + interval '19 hours') at time zone 'Pacific/Midway'    as midway_7pm_utc,
--          ('2026-07-01'::date + interval '19 hours') at time zone 'UTC'               as utc_7pm;
--
--   Expected (UTC instants of local 7pm on 2026-07-01):
--     auckland_7pm_utc = 2026-07-01 07:00+00  (NZST is UTC+12 in July → 19:00 local = 07:00 UTC)
--     london_7pm_utc   = 2026-07-01 18:00+00  (BST is UTC+1 in July    → 19:00 local = 18:00 UTC)
--     midway_7pm_utc   = 2026-07-02 06:00+00  (SST is UTC-11           → 19:00 local = 06:00 UTC next day)
--     utc_7pm          = 2026-07-01 19:00+00
