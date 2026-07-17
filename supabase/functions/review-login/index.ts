// review-login — Edge Function(边缘函数):App Store 审核专用登录。
//
// 为什么需要:App 用「邮箱一次性验证码(OTP)」登录,验证码发到邮箱里。
// 苹果审核员收不到 review 邮箱的验证码,没法用正常方式登录。
// 这个函数让审核员用一个「固定码」换取 review 账号的登录会话 —— 不需要收任何邮件。
//
// 安全性:
//   - 固定码是服务器密钥 REVIEW_LOGIN_CODE(只在 Supabase secrets 里,不在客户端、不在仓库)。
//   - 只对 REVIEW_EMAIL 这一个账号有效;该账号里没有任何真实数据(封存即消失,本就读不到信)。
//   - 没配 REVIEW_LOGIN_CODE 时:函数永远拒绝(401)→ 整个机制是「死的」,不影响任何人。
//   - 上架稳定后:删掉这个函数,或轮换 REVIEW_LOGIN_CODE 即可彻底关闭。
//
// 工作原理:校验固定码 → 用 service_role 给 review 账号生成 magiclink → 把其中的
//   hashed_token 返回给客户端 → 客户端用它 verifyOtp 换会话(全程无邮件)。

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 审核账号邮箱(需在 Supabase 预先建好这个用户)。
const REVIEW_EMAIL = 'review@dearfuture.space';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // 取出固定码。
  let code: string;
  try {
    const body = await req.json() as { code?: unknown };
    code = String(body.code ?? '').trim();
  } catch (_) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  // 校验:固定码必须等于服务器密钥。没设密钥 → 直接拒(机制关闭)。
  const expected = Deno.env.get('REVIEW_LOGIN_CODE');
  if (!expected || code !== expected) {
    return json({ error: 'Invalid review code' }, 401);
  }

  // 用 service_role(管理员钥匙)给 review 账号生成 magiclink。
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: REVIEW_EMAIL,
  });

  // generateLink 失败通常是「review 账号还没建」。
  if (error || !data?.properties?.hashed_token) {
    console.error('[review-login] generateLink failed:', error?.message);
    return json({ error: 'Review account is not set up' }, 500);
  }

  // 返回 hashed_token,客户端用它换会话。
  return json({ token_hash: data.properties.hashed_token });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
