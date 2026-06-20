import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { CourierPrime_400Regular } from '@expo-google-fonts/courier-prime';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // 加载 Cormorant Garamond + IBM Plex Mono 字体。不阻塞渲染:字体没好就先用系统字体兜底,
  // 加载完成后自动替换 —— 避免白屏(Expo Go 里字体加载可能较慢)。
  useFonts({ CormorantGaramond_600SemiBold, IBMPlexMono_500Medium, CourierPrime_400Regular });

  return (
    // SafeAreaProvider:给整个 app 提供"刘海/状态栏有多高"的真实数值。
    <SafeAreaProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {/* 只有一个屏幕,而且不要顶部标题栏 —— 一块干净的写信纸 */}
        <Stack screenOptions={{ headerShown: false }} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
