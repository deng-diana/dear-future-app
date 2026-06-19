import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// app 跟 Supabase 数据库说话的客户端。
// URL 和公开钥匙从 .env 读取(EXPO_PUBLIC_ 开头的变量会被打进 app)。
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: AsyncStorage, // 把登录凭证存到手机本地小仓库
      autoRefreshToken: true, // 快过期时自动续期,不用重登
      persistSession: true, // 关了 app 再开还记得你
      detectSessionInUrl: false, // 手机不是网页,不用从网址找登录信息
    },
  },
);
