// ops-stats — 给创始人专属数据看板(/ops 页面)提供统计数字的接口。
// 安全模型:请求头必须带 x-ops-key,且与服务端密钥 OPS_DASH_KEY 完全一致才放行。
//   - 密钥只存在两处:Supabase secrets(服务端)+ 创始人自己的浏览器(localStorage)。
//   - 返回的只有聚合数字(几个 count),不含任何信件内容 / 用户邮箱等隐私。
// 由看板页面 fetch 调用;不接 cron。

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPS_DASH_KEY = Deno.env.get('OPS_DASH_KEY') ?? '';

// 看板在 vercel 域名上,函数在 supabase 域名上 —— 跨域(CORS)头必须带,浏览器才允许调用。
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-ops-key, authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS }); // 浏览器的跨域预检

  // 密钥校验:没配 OPS_DASH_KEY(空)一律拒绝,防止"忘了配 = 大门敞开"。
  const key = req.headers.get('x-ops-key') ?? '';
  if (!OPS_DASH_KEY || key !== OPS_DASH_KEY) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await supabase.rpc('admin_daily_stats');
  if (error || !data) {
    console.error('[ops-stats] stats query failed:', error?.message);
    return new Response(JSON.stringify({ error: 'stats_failed' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
