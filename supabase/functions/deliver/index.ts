// 送达函数(Edge Function)。
// 职责:找出"今天到期、还没送过"的信 → 查到本人邮箱 → 用 Resend 发邮件 → 回填 delivered_at(防重发)。
// 用 service_role 钥匙运行,所以能绕过 RLS 读信、读用户邮箱、写 delivered_at。

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;

// Resend 已验证的发信子域名;看信页(部署在 Vercel)的地址。
const FROM_DOMAIN = 'mail.dearfuture.space';
const READ_BASE = 'https://dear-future-app.vercel.app';

// 演示/测试模式:为 true 时,不管送达日是哪天,只要没送过就立刻发(封存即送达)。
// ⚠️ 比赛结束后改回 false —— 否则未来的信会被立即发出,破坏产品核心逻辑。
const DEMO_MODE = false;

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 今天(UTC)的日期,'YYYY-MM-DD'。
  const today = new Date().toISOString().slice(0, 10);

  // 查"还没送过"的信;非演示模式才额外要求"送达日 <= 今天"。
  let q = supabase
    .from('letters')
    .select('id, owner_id, body, deliver_on, reveal_token')
    .is('delivered_at', null);
  if (!DEMO_MODE) q = q.lte('deliver_on', today);
  const { data: letters, error } = await q;

  if (error) {
    return json({ error: error.message }, 500);
  }

  const results: unknown[] = [];

  for (const letter of letters ?? []) {
    // 按 owner_id 查本人现在的邮箱(送达那刻才查,邮箱可更新)。
    const { data: userRes, error: uErr } = await supabase.auth.admin.getUserById(letter.owner_id);
    const email = userRes?.user?.email;
    if (uErr || !email) {
      results.push({ id: letter.id, sent: false, reason: 'no email for owner' });
      continue;
    }

    const year = new Date(letter.deliver_on).getFullYear();
    const readUrl = `${READ_BASE}/?token=${letter.reveal_token}`;

    // 发邮件:发件人显示名「You, in 20XX」,带看信链接 + 底部夹纯文字全文(保命副本)。
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `You, in ${year} <letters@${FROM_DOMAIN}>`,
        to: email,
        // 回复地址设成收信人本人 —— 这封信本就是「你写给你自己」,回信回到自己,
        // 也是给 Gmail 的强信任信号(自我对话=真实邮件,不是群发垃圾)。
        reply_to: email,
        subject: `A letter from you, ${year}`,
        // List-Unsubscribe:Gmail/Yahoo 现在期望每封信都带「一键退订」头,
        // 带上=加分,缺=扣分。⚠️ unsubscribe@dearfuture.space 必须是真实可收信的地址
        // (在 Namecheap 给 dearfuture.space 配个转发到你 Gmail 即可)。
        headers: {
          'List-Unsubscribe': '<mailto:unsubscribe@dearfuture.space?subject=unsubscribe>',
        },
        html:
          `<p>Some time ago, you sealed something for this exact day.</p>` +
          `<p><a href="${readUrl}">Open it &rarr;</a></p>` +
          `<hr>` +
          `<pre style="white-space:pre-wrap;font-family:Georgia,serif;font-size:16px;color:#4A3D31">${escapeHtml(letter.body)}</pre>` +
          // 落款:说明「你为什么收到这封信」,是正规发信人的合法性信号。
          `<hr><p style="font-size:12px;color:#8A7B6B">You received this because you sealed a letter with Reunite for delivery on this day. Reunite &middot; dearfuture.space</p>`,
        text:
          `Some time ago, you sealed something for this exact day.\n\n` +
          `Open it: ${readUrl}\n\n---\n\n${letter.body}\n\n` +
          `---\nYou received this because you sealed a letter with Reunite for delivery on this day.\nReunite · dearfuture.space`,
      }),
    });

    if (!emailRes.ok) {
      results.push({ id: letter.id, sent: false, reason: await emailRes.text() });
      continue;
    }

    // 发成功 → 回填 delivered_at(下次就不会再送)。
    await supabase
      .from('letters')
      .update({ delivered_at: new Date().toISOString() })
      .eq('id', letter.id);

    results.push({ id: letter.id, sent: true, to: email });
  }

  return json({ processed: results.length, results });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
