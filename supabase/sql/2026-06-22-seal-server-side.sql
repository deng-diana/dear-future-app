-- ============================================================================
-- Reunite — 服务器端封存:数据库 schema 变更
-- 文件:supabase/sql/2026-06-22-seal-server-side.sql
--
-- 何时运行:
--   seal-letter Edge Function 部署之前(或同时)运行这个文件。
--   这个文件只增加列和新表,不删除任何现有功能。
--   现有的 client INSERT RLS 策略暂时保留(让过渡期能新旧并行运行)。
--   真正"锁死客户端直接插入"的操作在第二个文件里。
--
-- 如何运行:
--   Supabase Dashboard → SQL Editor → 粘贴全部 → Run。
--   看到 "Success. No rows returned." 即成功。
-- ============================================================================

-- ── 1. letters 表:新增 seal_tier 列 ──
-- seal_tier 记录这封信用的是哪个档位:
--   'free'   = 免费封存(第一封、≤365 天、无媒体)
--   'words'  = 纯文字付款封存 ($2.99)
--   'photos' = 含照片/短视频付款封存 ($4.99)
--   'video'  = 含长视频付款封存 ($9.99)
-- NULL = 历史老数据(在这次迁移前封存的信),不影响任何现有查询。
alter table public.letters
  add column if not exists seal_tier text;

-- ── 1b. 唯一约束:每个账号最多 1 封免费封存 ──
-- 部分唯一索引(partial unique index):只对 seal_tier='free' 的行生效。
-- 数据库层强制"一个账号只能有一封免费信"——即使并发请求同时通过应用层的次数检查,
-- 第二个 INSERT 也会因唯一冲突(23505)失败。这堵住了"刷免费信"的竞态漏洞。
create unique index if not exists letters_one_free_per_owner
  on public.letters (owner_id)
  where seal_tier = 'free';

-- ── 2. used_transactions 表:防重放攻击(Replay Attack / 双花攻击) ──
-- 每当一笔付款被成功消耗,就在这里留下记录。
-- PRIMARY KEY = transaction_id:如果同一个 transactionId 被第二次提交,
--               数据库会抛出"唯一冲突"错误(error code 23505),服务器拒绝第二次封存。
-- 这是防"同一笔购买封多封信"的最后一道硬保障——在数据库层强制执行。
create table if not exists public.used_transactions (
  -- 商店交易 ID(App Store / Google Play 返回的原始 ID)。PRIMARY KEY = 唯一约束。
  transaction_id  text        primary key,
  -- 谁的购买(锁定到用户 ID,便于审计;不同用户的 ID 不同,不会互相阻塞)。
  owner_id        uuid        not null,
  -- 购买的是哪个产品(例如 'reunite.seal.words')。可为 null(兼容未来扩展)。
  product_id      text,
  -- 记录被创建的时间。now() = 当前时间戳。
  used_at         timestamptz not null default now()
);

-- 为 used_transactions 开启 RLS(行级安全)。
-- 注意:我们不创建任何 SELECT / INSERT / UPDATE / DELETE 策略。
-- 这意味着只有 service_role(管理员钥匙)才能读写这张表——
-- 任何普通用户(包括已登录用户)都无法直接访问,彻底隔离。
alter table public.used_transactions enable row level security;

-- (可选验证)运行完后可以执行下面这两行来确认:
-- select column_name, data_type from information_schema.columns
--   where table_name = 'letters' and column_name = 'seal_tier';
-- select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and tablename = 'used_transactions';
