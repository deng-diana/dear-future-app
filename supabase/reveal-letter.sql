-- ============================================================================
-- Reunite — reveal_letter() RPC
-- ----------------------------------------------------------------------------
-- 读信网页(web/reveal)用这个函数按 token 取信。它必须返回:
--   body, deliver_on, photo_url, video_url
-- 否则照片 / 视频 Polaroid 不会显示(页面读 letter.photo_url / letter.video_url)。
--
-- 安全:SECURITY DEFINER —— 以函数所有者身份运行,绕过 letters 表的 insert-only
-- RLS,但只允许"按 token 且已到送达日"读到这一封,读不到别人的信。
--
-- 应用方式:Supabase Dashboard → SQL Editor → 粘贴全部 → Run。
-- 出现 "Success. No rows returned." 即成功。
-- ============================================================================

-- 先删掉可能存在的旧版本(uuid / text 两种签名都试,IF EXISTS 不会报错)。
drop function if exists public.reveal_letter(uuid);
drop function if exists public.reveal_letter(text);

create function public.reveal_letter(p_token uuid)
returns table (body text, deliver_on date, photo_url text, video_url text)
language sql
stable
security definer
set search_path = public
as $$
  select l.body, l.deliver_on, l.photo_url, l.video_url
    from public.letters l
   where l.reveal_token::text = p_token::text   -- 不管 reveal_token 是 uuid 还是 text 都能比
     and l.deliver_on <= current_date;          -- 只有到了送达日才能读到
$$;

-- 让公开页面(anon)和登录用户都能调用。
grant execute on function public.reveal_letter(uuid) to anon, authenticated;
