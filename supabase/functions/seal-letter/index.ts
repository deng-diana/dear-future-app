// seal-letter — Edge Function(边缘函数)。
// 职责:
//   1. 验证调用者身份(JWT,绝不信任请求体里的 user_id)。
//   2. 校验输入(信的内容、送达日、媒体一致性、URL 合法性)。
//   3. 免费封存:检查该用户是否已用过免费次数,限制时间跨度 ≤ 365 天。
//   4. 付款封存:向 RevenueCat(应用内购买验证服务)确认购买凭证真实,
//      并检查该凭证没有被重复使用(防重放攻击)。
//   5. 通过所有检查后,用 service_role(管理员钥匙)写入数据库。
//
// ⚠️ IDOR 防御:uid 只从 JWT 里取,绝不从请求正文读取。
//    IDOR = Insecure Direct Object Reference,不安全的直接对象引用——
//    攻击者传入别人的 ID 来越权操作;JWT 经 Supabase 验证,无法伪造。

import { createClient } from 'jsr:@supabase/supabase-js@2';

// CORS = Cross-Origin Resource Sharing,跨域资源共享。
// 浏览器在正式请求前会先发一次 OPTIONS "预检请求";我们得回答"允许"。
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// MIN_SEAL_DAYS:封存最短跨度(天)。服务器端硬编码,防止客户端绕过。最早明天(1 天后)送达。
const MIN_SEAL_DAYS = 1;
// MAX_SEAL_DAYS:封存最长跨度(天)≈ 25 年。防止把信定到不合理的遥远未来(存储成本/异常日期)。
const MAX_SEAL_DAYS = 25 * 366;
// ALLOW_SANDBOX:是否允许 Sandbox(沙盒/测试)购买通过验证。
// 默认 false(生产安全):拒绝 is_sandbox 交易,否则任何 TestFlight/沙盒账号可 $0 封付费信。
// 测试期在 Supabase secrets 设 ALLOW_SANDBOX_PURCHASES=true;⚠️ 上线前务必移除。
const ALLOW_SANDBOX = Deno.env.get('ALLOW_SANDBOX_PURCHASES') === 'true';
// 信件正文最大字符数(防止恶意超大请求打爆数据库)。
const MAX_BODY_LENGTH = 100_000;

// 产品 ID 映射表:tier(档位名)→ RevenueCat 产品 ID(product identifier,应用商店里的唯一名称)。
// reunite.seal.words  = 纯文字封存
// reunite.seal.photos = 含照片/短视频封存
// reunite.seal.video  = 含长视频封存
const PRODUCT_IDS: Record<'words' | 'photos' | 'video', string> = {
  words: 'reunite.seal.words',
  photos: 'reunite.seal.photos',
  video: 'reunite.seal.video',
};

// Supabase 项目的存储公共 URL 前缀 —— 用于校验 photo_url / video_url 是否属于本项目。
// 格式:https://<project-ref>.supabase.co/storage/v1/object/public/memories/
// 在运行时动态构造,不硬编码 project-ref(每个部署环境可能不同)。
function storageMemoriesPrefix(supabaseUrl: string): string {
  return `${supabaseUrl}/storage/v1/object/public/memories/`;
}

Deno.serve(async (req: Request) => {
  // ── 第一步:处理预检请求(CORS OPTIONS) ──
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // 只接受 POST。405 = Method Not Allowed(方法不被允许)。
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // ── 第二步:从请求头取出 JWT,验证调用者身份 ──
  // supabase.functions.invoke() 会自动把当前登录用户的 JWT(登录令牌)放进 Authorization 头。
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'Missing Authorization header' }, 401);
  }

  // 用 ANON(匿名公开钥匙)建客户端,把 JWT 传进去,让 Supabase 验证令牌是谁的。
  // ANON KEY = 可以公开的"前台钥匙"。
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: userErr } = await anonClient.auth.getUser();
  if (userErr || !user) {
    // 令牌无效或已过期。
    return json({ error: 'Invalid or expired token' }, 401);
  }

  // uid = 经 Supabase 验证的、真实的调用者 ID。后续所有操作都锁定此 uid。
  const uid = user.id;

  // ── 第三步:解析请求正文 ──
  let body: string;
  let deliver_on: string;
  let photo_url: string | null = null;
  let video_url: string | null = null;
  let tier: 'words' | 'photos' | 'video' | null;
  let transactionId: string | undefined;
  // deliver_tz = the writer's IANA timezone (e.g. 'Europe/London'), used to deliver at LOCAL 7pm.
  let deliver_tz: string | null = null;

  try {
    const raw = await req.json() as {
      body?: unknown;
      deliver_on?: unknown;
      photo_url?: unknown;
      video_url?: unknown;
      tier?: unknown;
      transactionId?: unknown;
      deliver_tz?: unknown;
    };
    body = String(raw.body ?? '');
    deliver_on = String(raw.deliver_on ?? '');
    photo_url = raw.photo_url != null ? String(raw.photo_url) : null;
    video_url = raw.video_url != null ? String(raw.video_url) : null;
    tier = validateTier(raw.tier);
    transactionId = raw.transactionId != null ? String(raw.transactionId) : undefined;
    // 先取原始值;空/缺省 → null(留待下方降级为 UTC),非空再做 IANA 时区有效性校验。
    deliver_tz = raw.deliver_tz != null && String(raw.deliver_tz).trim() !== ''
      ? String(raw.deliver_tz).trim()
      : null;
  } catch (_) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  // 校验 deliver_tz(送达时区):
  //   - 缺省/空 → 存 null,deliver 端 due_letters() 会降级为 UTC 7pm(老逻辑,不丢信)。
  //   - 提供了但「不是合法 IANA 时区」→ 拒绝 400。绝不让未校验的字符串进库:
  //     due_letters() 里的 `at time zone <tz>` 遇到非法时区会直接报错,整批送达卡死。
  // 校验方法:用合法时区构造 Intl.DateTimeFormat 不会抛错,非法时区抛 RangeError。
  if (deliver_tz !== null) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: deliver_tz });
    } catch (_) {
      return json({ error: 'Invalid timezone' }, 400);
    }
  }

  // ── 第四步:服务器端输入验证 ──

  // 信的内容不能为空,也不能超过最大长度。
  if (!body.trim()) {
    return json({ error: 'Letter body is required' }, 400);
  }
  if (body.length > MAX_BODY_LENGTH) {
    return json({ error: `Letter body exceeds maximum length of ${MAX_BODY_LENGTH} characters` }, 400);
  }

  // 校验 deliver_on(送达日):必须是 YYYY-MM-DD 格式,且 ≥ 今天 + MIN_SEAL_DAYS 天。
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliver_on)) {
    return json({ error: 'deliver_on must be in YYYY-MM-DD format' }, 400);
  }
  const todayUTC = new Date().toISOString().slice(0, 10); // UTC 今天
  const minDate = addDaysToDateStr(todayUTC, MIN_SEAL_DAYS); // 最早合法送达日
  if (deliver_on < minDate) {
    return json({
      error: `deliver_on must be at least ${MIN_SEAL_DAYS} days from today (min: ${minDate})`,
    }, 400);
  }
  // 最长上限:不允许把信定到 ~25 年以后(免费/付费两路都适用)。
  const maxDate = addDaysToDateStr(todayUTC, MAX_SEAL_DAYS);
  if (deliver_on > maxDate) {
    return json({ error: `deliver_on must be within about 25 years (max: ${maxDate})` }, 400);
  }

  // 媒体与档位一致性检查:
  //   - 有媒体 → tier 必须是 'photos' 或 'video'。
  //   - 无媒体(tier 是 null 或 'words') → 不能有媒体 URL。
  const hasMedia = photo_url !== null || video_url !== null;
  if (hasMedia && tier !== 'photos' && tier !== 'video') {
    return json({ error: 'Media requires a paid media tier (photos or video)' }, 400);
  }
  if (!hasMedia && (tier === 'photos' || tier === 'video')) {
    return json({ error: 'Media tier requires at least one media URL' }, 400);
  }

  // 媒体 URL 安全检查:必须是本项目 Supabase Storage memories 桶的公开 URL。
  // 防止客户端传入任意外部 URL(钓鱼、数据注入等)。
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const memPrefix = storageMemoriesPrefix(supabaseUrl);
  // photo_url 是「多张照片打包成的 JSON 数组字符串」:["https://.../memories/a.jpg", ...]
  //(App 端 index.tsx 用 JSON.stringify(photoUrls) 打包,reveal 页再解析回来)。
  // 所以这里不能对整串做 startsWith —— 要先解析成数组,再要求每一个元素都是本项目
  // memories 桶的 URL;任何外部/畸形 URL 一律拒绝(防钓鱼 / 数据注入)。
  if (photo_url !== null) {
    let photoList: unknown;
    try {
      photoList = JSON.parse(photo_url);
    } catch (_) {
      return json({ error: 'photo_url must be a JSON array of memories storage URLs' }, 400);
    }
    if (
      !Array.isArray(photoList) ||
      photoList.length === 0 ||
      !photoList.every((u) => typeof u === 'string' && u.startsWith(memPrefix))
    ) {
      return json({ error: 'photo_url must be a JSON array of URLs in this project\'s memories storage bucket' }, 400);
    }
  }
  if (video_url !== null && !video_url.startsWith(memPrefix)) {
    return json({ error: 'video_url must be a URL in this project\'s memories storage bucket' }, 400);
  }

  // ── 第五步:免费封存路径(tier === null) ──
  // 新策略:纯文字胶囊「永久免费、不限次数」(用户决定:Words 永久免费)。
  //   - 无媒体:已在第四步保证。
  //   - 任意时长:1 天 ~ MAX_SEAL_DAYS(≈25 年),已在第三步统一校验。
  //   - 不再限制 365 天上限,也不再「一辈子只能免费一次」(配套迁移删掉了 letters_one_free_per_owner 唯一索引)。
  // 文字存储成本极低,所以放开不限次;付费仅针对真正占存储/带宽的媒体(photos/video)。
  if (tier === null) {
    const adminClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 写入信件,seal_tier = 'free'(无媒体)。
    const { error: insertErr } = await adminClient
      .from('letters')
      .insert({
        owner_id: uid,
        body: body.trim(),
        deliver_on,
        photo_url: null, // 免费封存不允许媒体
        video_url: null,
        seal_tier: 'free',
        deliver_tz, // 写信人时区(用于本地 7pm 送达);缺省为 null → deliver 端降级 UTC
      });

    if (insertErr) {
      console.error('[seal-letter] insert error (free):', insertErr.message);
      return json({ error: 'Failed to seal letter. Please try again.' }, 500);
    }

    return json({ ok: true });
  }

  // ── 第六步:付款封存路径(tier in 'words'|'photos'|'video') ──

  // transactionId(购买凭证 ID)是必须的。
  if (!transactionId || !transactionId.trim()) {
    return json({ error: 'transactionId is required for paid seals' }, 400);
  }
  const txId = transactionId.trim();

  // 对应的 RevenueCat 产品 ID。
  const productId = PRODUCT_IDS[tier];

  // 向 RevenueCat V1 REST API 验证购买凭证。
  // RevenueCat API = RevenueCat 提供的远程接口,我们发请求去问它"这个用户真的买了吗?"
  // 端点:GET https://api.revenuecat.com/v1/subscribers/{app_user_id}
  // 注意:app_user_id 必须等于 Supabase uid(要求 app 端已调用 Purchases.logIn(uid))。
  const rcKey = Deno.env.get('REVENUECAT_SECRET_KEY');
  if (!rcKey) {
    // 密钥未配置 → 服务器配置错误,拒绝(不允许在未验证状态下插入付款信件)。
    console.error('[seal-letter] REVENUECAT_SECRET_KEY not set');
    return json({ error: 'Payment verification is not configured on the server' }, 500);
  }

  let rcVerified = false;
  // 记录 RevenueCat 里实际匹配到的那笔交易,用它的稳定 ID 做防重放锁(见第七步)。
  let matchedEntry: { store_transaction_id?: string; id?: string } | null = null;
  try {
    const rcRes = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${rcKey}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!rcRes.ok) {
      // RevenueCat 返回错误(4xx / 5xx) → 拒绝(宁可误拒也不允许未验证的付款)。
      const errText = await rcRes.text();
      console.error('[seal-letter] RevenueCat error:', rcRes.status, errText);
      return json({
        error: 'Payment verification failed. Please try again or contact support.',
      }, 402);
    }

    // 解析 RevenueCat 响应,查找 non_subscriptions(非订阅、消耗品购买记录)。
    // non_subscriptions 是个对象:{ [product_id]: [ { store_transaction_id, ... }, ... ] }
    // store_transaction_id = App Store 或 Google Play 返回的原始交易 ID。
    const rcData = await rcRes.json() as {
      subscriber?: {
        non_subscriptions?: Record<string, Array<{
          id?: string;
          store_transaction_id?: string;
          purchase_date?: string;
          is_sandbox?: boolean;
        }>>;
      };
    };

    const entries = rcData?.subscriber?.non_subscriptions?.[productId] ?? [];
    // 沙盒闸门(生产 ALLOW_SANDBOX=false 时):先剔除 is_sandbox 交易——免费测试购买绝不能封真付费信。
    // 一次性过滤,保证下面两条匹配路径都受闸门保护。
    const usable = entries.filter((e) => ALLOW_SANDBOX || e.is_sandbox !== true);
    const RECENT_MS = 10 * 60 * 1000;
    const nowMs = Date.now();
    // 1) 首选:客户端带回的交易 ID 精确等于 RevenueCat 记录的 store_transaction_id 或 id。
    matchedEntry = usable.find((e) => e.store_transaction_id === txId || e.id === txId) ?? null;
    // 2) 仅当没有精确匹配时才兜底(兼容 StoreKit 2 下 SDK 与 REST API 的交易 ID 格式漂移):
    //    取「10 分钟内、且带服务器侧稳定 ID」的最新一笔。必须有稳定 ID,否则无法防重放、宁可拒绝。
    //    关键安全约束:防重放锁(见 lockId)永远绑定这笔真实交易的稳定 ID,绝不来自客户端输入。
    if (!matchedEntry) {
      matchedEntry =
        usable
          .filter(
            (e) =>
              (e.store_transaction_id || e.id) &&
              e.purchase_date &&
              nowMs - Date.parse(e.purchase_date) <= RECENT_MS,
          )
          .sort((a, b) => Date.parse(b.purchase_date!) - Date.parse(a.purchase_date!))[0] ?? null;
    }
    rcVerified = matchedEntry !== null;
  } catch (fetchErr) {
    // 网络故障 → 拒绝(不允许在无法验证时插入付款信件)。
    console.error('[seal-letter] RevenueCat fetch failed:', fetchErr);
    return json({
      error: 'Payment verification failed due to a network error. Please try again.',
    }, 402);
  }

  if (!rcVerified) {
    // RevenueCat 记录里找不到这笔交易 → 拒绝。
    return json({
      error: 'Purchase could not be verified. Please try again or contact support.',
    }, 402);
  }

  // ── 第七步:防重放攻击 ──
  // 检查 used_transactions 表:如果这个 transactionId 已经被用过,就拒绝。
  // 这防止同一笔购买被用来封存多封信(双花攻击 / Replay Attack)。
  // 注意:先插 used_transactions(利用 PRIMARY KEY 唯一约束)再插 letter,
  // 并发的第二个请求在插 used_transactions 时就会失败,永远到不了 insert letter。
  const adminClient = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 防重放锁:只用「RevenueCat 里匹配到的那笔真实交易」的服务器侧稳定 ID 上锁,
  // 绝不回退到客户端传来的 txId —— 否则伪造 txId 可在 10 分钟兜底窗口内重复封存(双花)。
  // 上面的匹配逻辑已保证 matchedEntry 必带稳定 ID;这里再做一次双保险,缺失就拒绝。
  const lockId = matchedEntry?.store_transaction_id || matchedEntry?.id;
  if (!lockId) {
    return json({ error: 'Purchase could not be verified. Please try again or contact support.' }, 402);
  }
  const { error: usedInsertErr } = await adminClient
    .from('used_transactions')
    .insert({
      transaction_id: lockId,
      owner_id: uid,
      product_id: productId,
    });

  if (usedInsertErr) {
    // 如果是唯一约束冲突(error code 23505),说明这笔交易已经被用过了。
    // Postgres error code 23505 = unique_violation(唯一冲突)。
    // Supabase JS SDK 把 Postgres 错误码放在 error.code 里。
    if (usedInsertErr.code === '23505') {
      return json({
        error: 'This purchase has already been used to seal a letter.',
      }, 409); // 409 = Conflict(冲突)
    }
    // 其他数据库错误。
    console.error('[seal-letter] used_transactions insert error:', usedInsertErr.message);
    return json({ error: 'Server error recording transaction. Please try again.' }, 500);
  }

  // ── 第八步:写入信件 ──
  // 此时:RevenueCat 验证通过 + 交易 ID 已被锁定(不可重用)。
  const { error: insertErr } = await adminClient
    .from('letters')
    .insert({
      owner_id: uid,
      body: body.trim(),
      deliver_on,
      photo_url: photo_url ?? null,
      video_url: video_url ?? null,
      seal_tier: tier,
      deliver_tz, // 写信人时区(用于本地 7pm 送达);缺省为 null → deliver 端降级 UTC
    });

  if (insertErr) {
    // 信没写进去,但 used_transactions 已插了。
    // 极端情况:这次请求失败了,transactionId 被锁定,用户再试会拿到 409。
    // 处理:我们把 used_transactions 的记录删掉,让用户可以重试。
    // 这不会引入双花风险:用户的购买凭证在 RevenueCat 那边是真实的,他只是换一次重试。
    const { error: rbErr } = await adminClient
      .from('used_transactions')
      .delete()
      .eq('transaction_id', lockId);
    if (rbErr) console.error('[seal-letter] rollback delete failed (txId 仍被锁,需人工处理):', rbErr.message);

    console.error('[seal-letter] letter insert error:', insertErr.message);
    return json({ error: 'Failed to seal letter. Please try again.' }, 500);
  }

  return json({ ok: true });
});

// ──────────────────────────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────────────────────────

// 统一 JSON 响应。status 默认 200。
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// 校验 tier 字段:只接受 null / 'words' / 'photos' / 'video'。
function validateTier(raw: unknown): 'words' | 'photos' | 'video' | null {
  if (raw === null || raw === undefined) return null;
  if (raw === 'words' || raw === 'photos' || raw === 'video') return raw;
  throw new Error(`Invalid tier: ${String(raw)}`);
}

// 两个 YYYY-MM-DD 字符串之间相差多少天(b - a)。
function daysBetween(a: string, b: string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((Date.parse(b) - Date.parse(a)) / msPerDay);
}

// 在 YYYY-MM-DD 字符串上加 n 天,返回新的 YYYY-MM-DD 字符串。
function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z'); // 强制 UTC,避免时区偏移
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
