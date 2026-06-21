// 开场页(Splash)— 演示时先显示这一屏,点「Start」才进入写信页。
// 重要:绝不自动跳转,只有按钮触发 onStart()(用户明确要求)。
// 背景是整张装饰图(纸+叶影+钢笔+怀表+信封),上面叠 logo / Reunite 切图 / 分隔线 / 标语 / 按钮。

import { useRef } from 'react';
import { Animated, Dimensions, Image, ImageBackground, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const { height: SH } = Dimensions.get('window');

type Props = {
  onStart: () => void; // 点 Start 后通知外面进入写信页
};

export default function Splash({ onStart }: Props) {
  // 点 Start 时整屏轻轻淡出,再真正切走(只此一条出场路径,无自动跳转)。
  const fade = useRef(new Animated.Value(1)).current;

  function handleStart() {
    Animated.timing(fade, { toValue: 0, duration: 420, useNativeDriver: true }).start(({ finished }) => {
      if (finished) onStart();
    });
  }

  return (
    <Animated.View style={[styles.root, { opacity: fade }]}>
      <ImageBackground source={require('@/assets/images/splash-bg.png')} style={styles.bg} resizeMode="cover">
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {/* 上半部分:火漆 logo + Reunite 切图 + 金色分隔线 + 标语 */}
          <Animated.View style={styles.top}>
            <Image source={require('@/assets/images/seal-stamp.png')} style={styles.logo} resizeMode="contain" />
            <Image source={require('@/assets/images/splash-wordmark.png')} style={styles.wordmark} resizeMode="contain" />
            <Image source={require('@/assets/images/splash-divider.png')} style={styles.divider} resizeMode="contain" />
            <Text style={styles.tagline}>Write to your future self.{'\n'}Meet the person you used to be.</Text>
          </Animated.View>

          {/* 底部:Start 按钮(与写信页同款实心主题色) */}
          <Animated.View style={styles.footer}>
            <Pressable style={styles.button} onPress={handleStart} accessibilityRole="button" accessibilityLabel="Start">
              <Text style={styles.buttonText}>Start</Text>
            </Pressable>
          </Animated.View>
        </SafeAreaView>
      </ImageBackground>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bg: { flex: 1 },
  // 上下分布:内容靠上,按钮沉底(中间留白自动撑开)
  safe: { flex: 1, justifyContent: 'space-between' },

  // 上半组:居中,距顶约 12% 屏高
  top: { alignItems: 'center', paddingTop: SH * 0.12 },
  logo: { width: 108, height: 162 },          // 透明火漆(稍微大一点点;原图 2:3,内含上下留白)
  wordmark: { width: 168, height: 49, marginTop: -22 }, // Reunite 切图(缩小 + 上移靠近 logo)
  divider: { width: 188, height: 11, marginTop: 12 },   // 金色分隔线(227×13)
  tagline: {
    fontFamily: 'CourierPrime_400Regular',
    fontSize: 14,
    lineHeight: 21,
    color: '#B26B24',
    textAlign: 'center',
    marginTop: 14,
  },

  // 底部按钮容器:左右页边距更大 → 按钮更窄;离底一点
  footer: { paddingHorizontal: 64, paddingBottom: 56 },
  button: {
    backgroundColor: '#B26B24',
    paddingVertical: 16,
    borderRadius: 0,           // 直角(与写信页一致)
    alignItems: 'center',
  },
  buttonText: { fontFamily: 'CourierPrime_400Regular', color: '#FBEFDB', fontSize: 16, letterSpacing: 0.5 },
});
