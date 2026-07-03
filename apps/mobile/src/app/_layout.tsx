import { CourierPrime_400Regular, CourierPrime_700Bold } from '@expo-google-fonts/courier-prime';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import * as Sentry from '@sentry/react-native';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { configurePurchases, clearPurchasesUser, setPurchasesUser } from '@/lib/purchases';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme';

// EXPO_PUBLIC_SENTRY_DSN — Data Source Name (the address Sentry uses to receive crash reports).
// It is a public URL (safe to expose in the bundle), but we keep it in an env var so builds
// without the secret work unchanged (Expo Go, local dev without .env).
// DSN = Data Source Name: the unique URL that identifies which Sentry project to send events to.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

    // Never send user PII (Personally Identifiable Information — any data that can identify a person).
    // This prevents IP addresses, user-agent strings, etc. from being attached automatically.
    sendDefaultPii: false,

    // tracesSampleRate: 0 means "record crashes only, never record performance traces."
    // Performance tracing would send request URLs and timing — we skip it for privacy + cost.
    tracesSampleRate: 0,

    // Track whether users experience crashes during a session (anonymous session = one app open).
    enableAutoSessionTracking: true,

    // Tag events so we can tell production crashes from dev runs in the Sentry dashboard.
    environment: __DEV__ ? 'development' : 'production',

    // beforeSend: a final privacy scrub on every error event before it leaves the device.
    // We strip request.data (request body — could contain letter text) and any "extra" fields
    // that code elsewhere might have accidentally attached.
    beforeSend(event) {
      // Strip request body — this is where letter content could accidentally leak.
      if (event.request) {
        delete event.request.data;
        // Also wipe cookies and headers to be safe.
        delete event.request.cookies;
        delete event.request.headers;
      }
      // Strip any arbitrary key-value extras attached by instrumentation.
      delete event.extra;
      return event;
    },
  });
}

function RootLayout() {
  const colorScheme = useColorScheme();

  // RevenueCat SDK 初始化:app 一启动就配置好购买管道。
  // configurePurchases() 在 web / 无密钥时是 no-op(什么都不做,不报错)。
  useEffect(() => {
    configurePurchases();
  }, []);

  // 监听登录状态变化:
  //   - 用户登录(SIGNED_IN)→ 调 setPurchasesUser(uid),让 RevenueCat 的 app_user_id
  //     与 Supabase uid 对齐。服务器端购买验证会用 uid 查 RevenueCat 的购买记录,
  //     如果不对齐,服务器查不到这个用户的购买,验证会失败。
  //   - 用户登出(SIGNED_OUT)→ 调 clearPurchasesUser(),让 RevenueCat 回到匿名状态,
  //     避免下一个登录的用户被关联到上一个用户的购买记录。
  // web / 无密钥时:setPurchasesUser / clearPurchasesUser 都是 no-op,安全跳过。
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user?.id) {
        // 不 await —— 认证状态变化是异步事件,我们 fire-and-forget(触发后不阻塞)。
        // 购买验证发生在封存那一刻,有充足时间让 logIn 完成。
        setPurchasesUser(session.user.id).catch(() => {});
      } else if (event === 'SIGNED_OUT') {
        clearPurchasesUser().catch(() => {});
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // 加载字体:Courier Prime(全站打字机字体)+ IBM Plex Mono(保留备用)。
  // 字体没加载完之前先显示一块干净的奶油色底(不白屏),加载好再渲染界面 ——
  // 这样开场页/标语/按钮从第一帧起就是 Courier Prime,不会先闪一下系统字体。
  const [fontsLoaded] = useFonts({ IBMPlexMono_500Medium, CourierPrime_400Regular, CourierPrime_700Bold });

  return (
    // SafeAreaProvider:给整个 app 提供"刘海/状态栏有多高"的真实数值。
    <SafeAreaProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {fontsLoaded ? (
          // 只有一个屏幕,而且不要顶部标题栏 —— 一块干净的写信纸
          <Stack screenOptions={{ headerShown: false }} />
        ) : (
          // 字体加载中的占位:奶油色满屏,避免白屏,也避免系统字体抢先渲染
          <View style={{ flex: 1, backgroundColor: colors.background }} />
        )}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

// Sentry.wrap() adds a Profiler boundary and a TouchEventBoundary so Sentry can
// capture unhandled JS errors at the React tree root.
// When SENTRY_DSN is absent, Sentry.init() was never called, so wrap() is still
// safe to call — it just adds negligible overhead with no network activity.
export default Sentry.wrap(RootLayout);
