import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

// app 跟 Supabase 数据库说话的客户端。
// URL 和公开钥匙从 .env 读取(EXPO_PUBLIC_ 开头的变量会被打进 app)。
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  // 暂不用登录,先不保存会话;下一步加邮箱 OTP(One-Time Password)时再开。
  { auth: { persistSession: false } },
);
