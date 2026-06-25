-- ============================================================================
-- Reunite — reveal_letter() RPC
-- ----------------------------------------------------------------------------
-- 读信网页(web/reveal)用这个函数按 token 取信。它必须返回:
--   body, deliver_on, photo_url, video_url, sealed_at, deliver_tz
-- 否则照片 / 视频 Polaroid 不会显示(页面读 letter.photo_url / letter.video_url),
-- 信纸上方的「写信那一刻」也显示不出来(页面读 letter.sealed_at / letter.deliver_tz)。
--
-- sealed_at = 封信那一刻的时间戳(带时区);deliver_tz = 写信人当时的 IANA 时区
-- (例如 "Europe/London")。两者一起 → 网页能把写信时间换算成「写信人当时的本地时间」显示。
-- 两者都不是机密:就是"这封信是几点、在哪个时区写的"。
--
-- 安全:SECURITY DEFINER —— 以函数所有者身份运行,绕过 letters 表的 insert-only
-- RLS,但只允许"按 token 且已到送达日"读到这一封,读不到别人的信。
--
-- 应用方式:Supabase Dashboard → SQL Editor → 粘贴全部 → Run。
-- 出现 "Success. No rows returned." 即成功。
-- ============================================================================

-- 先删掉可能存在的旧版本(uuid / text 两种签名都试,IF EXISTS 不会报错)。
-- 注:改了返回列就必须先 drop 再 create —— Postgres 不允许用 CREATE OR REPLACE 改返回类型。
drop function if exists public.reveal_letter(uuid);
drop function if exists public.reveal_letter(text);

create function public.reveal_letter(p_token uuid)
returns table (body text, deliver_on date, photo_url text, video_url text, sealed_at timestamptz, deliver_tz text)
language sql
stable
security definer
set search_path = public
as $$
  select l.body, l.deliver_on, l.photo_url, l.video_url, l.sealed_at, l.deliver_tz
    from public.letters l
   where l.reveal_token::text = p_token::text   -- 不管 reveal_token 是 uuid 还是 text 都能比
     and l.delivered_at is not null;            -- 只有「已投递」才能读到 —— 这才是真正的判据。
                                                 -- (投递链接本就只在送达邮件里;delivered_at 由 deliver
                                                 --  函数发信成功后回填,所以正常 / 审核 demo 投递都成立,
                                                 --  且读不到「还没发出去」的信。比看 deliver_on 日期更正确。)
$$;

-- 让公开页面(anon)和登录用户都能调用。
grant execute on function public.reveal_letter(uuid) to anon, authenticated;
