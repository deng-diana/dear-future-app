// daily-digest — 每天 06:00 UTC 由 pg_cron 触发的「哨兵」。
// 设计(创始人拍板):数据看板管数据(/ops 页面,想看去看);邮箱只收两种信 ——
//   1. ⚠️ 警报:overdue_undelivered(到期却没送出去的信)> 0 → 立刻发,红色置顶。
//      这比监控 Resend 本身更准:不管哪个环节坏,最终都体现在「该送的没送」。
//   2. ✅ 心跳:每周一发一封「一切正常」。防"哨兵自己悄悄死了"的盲区 ——
//      哪个周一没收到这封,创始人就知道管道死了。其余六天,没事 = 不发 = 零噪音。
// 用 service_role 运行(能调被锁的 admin_daily_stats)。

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;

const FOUNDER_EMAIL = 'dengdan01@gmail.com';
const FROM_DOMAIN = 'mail.dearfuture.space';
const DASHBOARD_URL = 'https://dear-future-app.vercel.app/ops';

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1. 拿统计(只用到 overdue;心跳邮件里顺带附两三个数,给周一一点惊喜)。
  const { data: stats, error } = await supabase.rpc('admin_daily_stats');
  if (error || !stats) {
    console.error('[digest] stats query failed:', error?.message);
    return new Response(JSON.stringify({ ok: false, error: error?.message }), { status: 500 });
  }
  const s = stats as Record<string, number>;
  const overdue = s.overdue_undelivered ?? 0;
  const isMonday = new Date().getUTCDay() === 1; // 0=周日, 1=周一

  // 2. 决定今天要不要发信:出事 → 必发;周一 → 心跳;其余 → 安静。
  if (overdue === 0 && !isMonday) {
    console.log('[digest] healthy, not Monday — staying quiet.');
    return new Response(JSON.stringify({ ok: true, sent: false }), { status: 200 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const subject = overdue > 0
    ? `⚠️ Reunite ALERT — ${overdue} overdue undelivered letter(s)`
    : `✅ Reunite weekly heartbeat — all healthy (${today})`;

  const alertHtml = overdue > 0
    ? `<p style="color:#A02C2C;font-weight:700;">⚠️ ${overdue} letter(s) are past their delivery date and were NOT delivered. ` +
      `Check the deliver function logs and Resend status now.</p>`
    : `<p style="color:#3E7A4E;">✅ Delivery pipeline healthy. This is your Monday heartbeat — ` +
      `if this email ever stops arriving on Mondays, the pipeline itself is down.</p>`;

  const html =
    `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:24px;color:#5B4638;">` +
    `<h2 style="margin:0 0 4px;">Reunite</h2>` +
    `<p style="margin:0 0 20px;color:#6B5A4B;">${today}</p>` +
    alertHtml +
    `<p style="font-size:14px;color:#6B5A4B;">Letters sealed: ${s.letters_total} · Delivered: ${s.delivered_total} · Users: ${s.total_users}</p>` +
    `<p><a href="${DASHBOARD_URL}" style="color:#7A1E1E;">Open the full dashboard →</a></p>` +
    `</div>`;

  // 3. 发送;失败返回 500(cron 的 run_details 能看到失败记录)。
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: `Reunite Ops <ops@${FROM_DOMAIN}>`,
      to: [FOUNDER_EMAIL],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('[digest] Resend failed:', res.status, body);
    return new Response(JSON.stringify({ ok: false, resend: res.status }), { status: 500 });
  }

  console.log(`[digest] sent: ${subject}`);
  return new Response(JSON.stringify({ ok: true, sent: true, overdue }), { status: 200 });
});
