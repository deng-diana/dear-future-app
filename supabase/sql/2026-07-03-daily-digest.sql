-- 2026-07-03 — Daily digest: stats function + cron job.
--
-- 两件事:
--   1. admin_daily_stats() — 一个「统计问答」函数,把日报要的所有数字一次算好,
--      返回一个 JSON。SECURITY DEFINER = 以创建者(postgres 管理员)的身份运行,
--      所以它能读 auth.users(注册用户表)和被 RLS 锁住的 letters 表。
--      ⚠️ 只授权给 service_role(服务端钥匙)调用 —— anon(App 里那把公开钥匙)
--      不能调,否则任何人都能查你的经营数据。
--   2. pg_cron 每天 06:00 UTC(伦敦早上)调 daily-digest Edge Function 发日报邮件。
--
-- 用法:整段粘进 Supabase Dashboard → SQL Editor → Run。可重复运行(幂等)。

-- ── 1. 统计函数 ──────────────────────────────────────────────────────────────
create or replace function public.admin_daily_stats()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    -- 用户:总注册数 + 最近 24 小时新注册
    'total_users',      (select count(*) from auth.users),
    'new_users_24h',    (select count(*) from auth.users where created_at > now() - interval '24 hours'),

    -- 信:总封存数 + 最近 24 小时封存数
    'letters_total',    (select count(*) from public.letters),
    'letters_24h',      (select count(*) from public.letters where sealed_at > now() - interval '24 hours'),

    -- 媒体:带照片的信 / 带视频的信(总数)
    'with_photos',      (select count(*) from public.letters where photo_url is not null),
    'with_video',       (select count(*) from public.letters where video_url is not null),

    -- 付费:按档位数数(words 免费;photos $2.99;video $5.99)+ 估算总收入(美元)
    'paid_photos',      (select count(*) from public.letters where seal_tier = 'photos'),
    'paid_video',       (select count(*) from public.letters where seal_tier = 'video'),
    'revenue_usd',      (select round(
                           (select count(*) from public.letters where seal_tier = 'photos') * 2.99
                         + (select count(*) from public.letters where seal_tier = 'video')  * 5.99
                         , 2)),

    -- 投递:已送达总数 + 最近 24 小时送达数
    'delivered_total',  (select count(*) from public.letters where delivered_at is not null),
    'delivered_24h',    (select count(*) from public.letters where delivered_at > now() - interval '24 hours'),

    -- ⚠️ 健康检查:过期还没送出去的信(到期日已过去整整一天以上,却没有送达章)。
    -- 正常必须是 0;>0 = 投递管道出了问题,日报会用红色报警。
    'overdue_undelivered', (select count(*) from public.letters
                             where delivered_at is null
                               and deliver_on   <  current_date - 1),

    -- 存储水位:memories 桶已用多少 MB(免费档上限 1024 MB;>800 该升级了)。
    'storage_mb',       (select coalesce(round(sum((metadata->>'size')::bigint) / 1048576.0), 0)
                          from storage.objects where bucket_id = 'memories')
  );
$$;

-- 权限:先收回所有人的调用权,再只发给 service_role。
revoke all on function public.admin_daily_stats() from public, anon, authenticated;
grant execute on function public.admin_daily_stats() to service_role;

-- ── 2. 每天 06:00 UTC 调 daily-digest 函数(先删旧的再排,幂等) ──────────────
select cron.unschedule('daily-digest')
where exists (select 1 from cron.job where jobname = 'daily-digest');

select cron.schedule(
  'daily-digest',
  '0 6 * * *',   -- 每天 06:00 UTC = 伦敦早上(夏令时 07:00)
  $$
  select net.http_post(
    url     := 'https://vxvgcozpuerrjtoxwumi.supabase.co/functions/v1/daily-digest',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4dmdjb3pwdWVycmp0b3h3dW1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNzAyODQsImV4cCI6MjA5Njg0NjI4NH0.POL88HDZCOubSx-2b-i0HBP3CK7Sn72TZRzeKz-nuhk"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- 验证:应看到 daily-digest + deliver-due-letters 两行,active 都为 true。
select jobid, jobname, schedule, active from cron.job;
