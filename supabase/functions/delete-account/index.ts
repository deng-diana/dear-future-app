// 删除账号函数(Edge Function / 边缘函数)。
// 职责:验证调用者身份 → 删掉他的所有信 → 删掉他的账号。
// ⚠️ 安全核心:要删谁,只看请求头里的 JWT(登录凭证),绝不从请求正文或 URL 参数里读。
//    这样无论怎么构造请求,也只能删自己的账号,不能删别人的(防止 IDOR 漏洞)。
//    IDOR = Insecure Direct Object Reference,不安全的直接对象引用 —— 攻击者传入别人的 ID 来越权操作。

import { createClient } from 'jsr:@supabase/supabase-js@2';

// CORS = Cross-Origin Resource Sharing,跨域资源共享。
// 浏览器在正式请求之前会先发一次 "预检请求"(OPTIONS),告诉服务器:
// "我要从这个域名发请求,你允许吗?" —— 我们得回答"允许"。
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  // 第一步:处理预检请求(OPTIONS)。直接放行,不做身份验证。
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // 只接受 POST —— 删除是破坏性操作,绝不响应 GET 等其它方法,
  // 避免被预取/误导航/带缓存令牌的浏览器导航意外触发。
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // 第二步:从请求头取出 JWT(登录令牌)。
  // supabase.functions.invoke() 会自动把当前登录用户的 JWT 放进 Authorization 头。
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    // 没有令牌 = 没登录,拒绝。
    return json({ error: 'Missing Authorization header' }, 401);
  }

  // 第三步:用 ANON 匿名公开钥匙建一个客户端,把 JWT 塞进去,让 Supabase 验证这个令牌是谁的。
  // ANON = Anonymous,匿名键 —— 这是可以公开的"前台钥匙",只能做 RLS(行级安全)允许的操作。
  // 重要:我们把 JWT 交给 Supabase 验证,它返回的 user.id 就是这个令牌对应的真实用户 ID。
  // 绝对不接受请求正文里传来的 user_id —— 那个可以伪造;JWT 里的不能。
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: userErr } = await anonClient.auth.getUser();
  if (userErr || !user) {
    // 令牌无效或已过期,拒绝。
    return json({ error: 'Invalid or expired token' }, 401);
  }

  // 至此,uid 是经过 Supabase 验证的、真实的调用者 ID。只删这个人的数据。
  const uid = user.id;

  // 第四步:用 SERVICE_ROLE 服务角色钥匙建第二个客户端。
  // SERVICE_ROLE = 超级管理员钥匙,能绕过 RLS 直接读写任何数据。
  // 这把钥匙只能放在 Edge Function 里,永远不能打包进 app 代码。
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 第五步:删掉这个用户的所有信(letters 表里 owner_id = 他的 ID 的行)。
  // 信一旦被删,就算之前已封存、还没到送达日,也永远不会被送出去了。
  const { error: lettersErr } = await adminClient
    .from('letters')
    .delete()
    .eq('owner_id', uid);

  if (lettersErr) {
    return json({ error: `Failed to delete letters: ${lettersErr.message}` }, 500);
  }

  // 第六步:删掉 Auth 系统里的用户账号本身(邮箱、登录凭证全部抹除)。
  const { error: authErr } = await adminClient.auth.admin.deleteUser(uid);

  if (authErr) {
    return json({ error: `Failed to delete auth user: ${authErr.message}` }, 500);
  }

  // 两步都成功 → 告知调用方删除完成。
  return json({ ok: true });
});

// 统一的 JSON 响应助手函数。把任意对象序列化成 JSON 字符串返回给调用方。
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
