import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* 只有一个屏幕,而且不要顶部标题栏 —— 一块干净的写信纸 */}
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
