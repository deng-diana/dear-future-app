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

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 找出"现在到期"的信:正常由 SQL 函数 due_letters() 决定到期与否——
  // 它按每个用户自己的时区,在 deliver_on 当天的本地 19:00(7pm)到点才放行;
  // 没有时区(老信)降级为 UTC 7pm。delivered_at 已填的会被它过滤掉(防重发)。
  //
  // 审核临时开关(2026-07 上线后改为「按账号圈定」,对真实用户永远安全):
  // DELIVER_DEMO_MODE == 'true' 时,演示账号(DELIVER_DEMO_EMAILS,逗号分隔,
  // 默认 review@dearfuture.space)的信不看日期、立刻发 —— 让审核员/创始人当场验证送达。
  // 其他所有账号照常走 due_letters() 的到期规则 —— 上线后开着它也不会破坏真实用户的信。
  // secret 改了即时生效,无需重新部署。
  const DEMO = Deno.env.get('DELIVER_DEMO_MODE') === 'true';
  const DEMO_EMAILS = (Deno.env.get('DELIVER_DEMO_EMAILS') ?? 'review@dearfuture.space')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // 永远先取「正常到期」的信;演示模式再额外补上「演示账号的未送信」(下面按邮箱过滤)。
  const { data: dueData, error } = await supabase.rpc('due_letters');
  if (error) {
    return json({ error: error.message }, 500);
  }
  type LetterRow = { id: string; owner_id: string; body: string; deliver_on: string; reveal_token: string; sealed_at: string | null; _demoOnly?: boolean };
  const letters: LetterRow[] = (dueData ?? []) as LetterRow[];
  if (DEMO) {
    const dueIds = new Set(letters.map((l) => l.id));
    const { data: extra, error: e2 } = await supabase
      .from('letters')
      .select('id, owner_id, body, deliver_on, reveal_token, sealed_at')
      .is('delivered_at', null);
    if (!e2) {
      for (const l of (extra ?? []) as LetterRow[]) {
        if (!dueIds.has(l.id)) letters.push({ ...l, _demoOnly: true }); // 只是候选,发送前还要验邮箱
      }
    }
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

    // 演示圈定:只因演示模式被捞出来(还没到期)的信,主人必须是演示账号;否则跳过。
    if (letter._demoOnly && !DEMO_EMAILS.includes(email.toLowerCase())) {
      results.push({ id: letter.id, sent: false, reason: 'demo scope: not a demo account' });
      continue;
    }

    const year = new Date(letter.deliver_on).getFullYear();
    const readUrl = `${READ_BASE}/?token=${letter.reveal_token}`;
    // 写信那天(从 sealed_at 取);用于主题与正文「the you of {日期}」。老数据若无 sealed_at 则降级。
    const writtenDate = letter.sealed_at
      ? new Date(letter.sealed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : null;
    const subject = writtenDate ? `A letter from the you of ${writtenDate}` : 'A letter you left for yourself';
    // "312 days ago — on June 27, 2026 —": the span makes you FEEL the time that
    // passed; the exact date anchors it. Same-day delivery (demo) drops the
    // redundant "Today —" and just leads with the date.
    const ago = letter.sealed_at ? timeAgo(daysSince(letter.sealed_at)) : null;
    const leadHtml = ago && ago !== 'Today'
      ? `${ago} — on <strong>${writtenDate}</strong> —`
      : writtenDate ? `On <strong>${writtenDate}</strong>,` : 'Some time ago,';
    const leadText = ago && ago !== 'Today'
      ? `${ago} — on ${writtenDate} —`
      : writtenDate ? `On ${writtenDate},` : 'Some time ago,';
    const wroteLine = `${leadHtml} you sat down and wrote yourself this letter.`;
    const wroteLineText = `${leadText} you sat down and wrote yourself this letter.`;

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
        subject,
        // List-Unsubscribe:Gmail/Yahoo 现在期望每封信都带「一键退订」头,
        // 带上=加分,缺=扣分。⚠️ unsubscribe@dearfuture.space 必须是真实可收信的地址
        // (在 Namecheap 给 dearfuture.space 配个转发到你 Gmail 即可)。
        headers: {
          'List-Unsubscribe': '<mailto:unsubscribe@dearfuture.space?subject=unsubscribe>',
        },
        // 邮件 = 温暖的「邀请」(不再把全文糊在上面);真正的揭晓在网页揭晓页(慢拆封 + 媒体 + 音乐)。
        // 最底部仍夹一段安静的全文「保命副本」—— manifesto 第3戒:信永远活在你自己邮箱,公司没了也在。
        html:
          // 预览行(preheader):Gmail 主题后那行灰字;隐藏的一行温柔铺垫。
          `<span style="display:none;max-height:0;overflow:hidden;opacity:0;">Some time ago you asked us to keep this safe until today. It's time.</span>` +
          `<div style="background:#FAE6C9;padding:40px 16px;font-family:Georgia,serif;">` +
            `<div style="max-width:520px;margin:0 auto;color:#5A3A24;font-size:17px;line-height:1.7;">` +
              `<p style="margin:0 0 1.1em;">${wroteLine}</p>` +
              `<p style="margin:0 0 1.1em;">Not to anyone else. To you, today.</p>` +
              `<p style="margin:0 0 1.1em;">You asked for it to find you on this exact day. So here it is.</p>` +
              `<p style="margin:0 0 1.8em;">Take a quiet moment. Then, when you're ready, meet the person you used to be.</p>` +
              // A "sealed letter" card instead of a flat button: wax seal on the left,
              // "Open" beside it — a wide, envelope-like (landscape) shape. Email-safe:
              // table layout + inline styles + PNG (not SVG). The seal keeps its TRUE 2:3
              // ratio (52x78) so it is never squished. Bulletproof alt: if images are
              // blocked, the alt text + the visible "Open your letter" still read and the
              // whole card stays clickable.
              `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0.6em auto 1.4em;"><tr><td style="background:#FFF3D9;border-radius:6px;padding:18px 30px;">` +
                `<a href="${readUrl}" style="text-decoration:none;color:#B26B24;display:block;">` +
                  `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
                    `<td valign="middle" style="padding-right:12px;">` +
                      `<img src="https://dear-future-app.vercel.app/assets/seal-stamp.png" width="52" height="78" alt="Open your letter" style="display:block;width:52px;height:78px;border:0;outline:none;" />` +
                    `</td>` +
                    `<td valign="middle" style="text-align:left;">` +
                      `<div style="font-family:Georgia,serif;font-size:18px;color:#B26B24;">Open your letter</div>` +
                    `</td>` +
                  `</tr></table>` +
                `</a>` +
              `</td></tr></table>` +
              `<p style="margin:0;font-size:13px;color:#927C5E;">You wrote this with Reunite and chose today for it to return. No one else has read it. No one else ever will.</p>` +
              `<hr style="border:none;border-top:1px solid #E3CDB4;margin:2em 0;">` +
              `<p style="margin:0 0 1em;font-size:12px;color:#9C8769;font-style:italic;">Your own words, kept here for safekeeping — no link, no app, nothing to open. They are simply yours, for as long as this inbox lasts.</p>` +
              `<pre style="white-space:pre-wrap;font-family:Georgia,serif;font-size:15px;color:#6E5640;margin:0;">${escapeHtml(letter.body)}</pre>` +
            `</div>` +
          `</div>`,
        text:
          `${wroteLineText}\n\n` +
          `Not to anyone else. To you, today.\n\n` +
          `You asked for it to find you on this exact day. So here it is.\n\n` +
          `Take a quiet moment. Then, when you're ready, meet the person you used to be.\n\n` +
          `Open your letter: ${readUrl}\n\n` +
          `You wrote this with Reunite and chose today for it to return. No one else has read it. No one else ever will.\n\n` +
          `──────────\n` +
          `Your own words, kept here for safekeeping — no link, no app, nothing to open. They are simply yours, for as long as this inbox lasts.\n\n` +
          `${letter.body}`,
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

// 距封信过了多少天。纯函数:输入封信时间戳(ISO 字符串),输出整数天。
// 原理:日期 = 距 1970 的毫秒数;两时间相减得毫秒差,÷ 一天的毫秒数 = 天数。
const MS_PER_DAY = 86_400_000;
function daysSince(sealedAt: string): number {
  const elapsed = Date.now() - new Date(sealedAt).getTime();
  return Math.max(0, Math.round(elapsed / MS_PER_DAY)); // 不为负;四舍五入到整天
}

// 把天数变成一句"多久以前"。纯函数,处理单复数与边界(0 天 / 1 天)。
function timeAgo(days: number): string {
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`; // e.g. "312 days ago"
}
