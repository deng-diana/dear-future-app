import { CourierPrime_400Regular, CourierPrime_700Bold } from '@expo-google-fonts/courier-prime';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  const colorScheme = useColorScheme();

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
          <View style={{ flex: 1, backgroundColor: '#FAE6C9' }} />
        )}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
