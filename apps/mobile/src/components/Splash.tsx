// 开场页(Splash)— 演示时先显示这一屏,点「Start」才进入写信页。
// 重要:绝不自动跳转,只有按钮触发 onStart()(用户明确要求)。
// 背景是整张装饰图(纸+叶影+钢笔+怀表+信封),上面叠 logo / Reunite 切图 / 分隔线 / 标语 / 按钮。

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Dimensions, Image, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '@/components/Button';
import { colors, fonts } from '@/theme';

const { width: SW, height: SH } = Dimensions.get('window');

type Props = {
  onStart: () => void; // 点 Start 后通知外面进入写信页
};

export default function Splash({ onStart }: Props) {
  // 点 Start 时整屏轻轻淡出,再真正切走(只此一条出场路径,无自动跳转)。
  const fade = useRef(new Animated.Value(1)).current;

  // A13: 读取系统"减少动画"设置——开启时跳过淡出动画,直接切走
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  function handleStart() {
    if (reduceMotion) {
      // 减少动画:跳过 420ms 淡出,立即切走
      onStart();
      return;
    }
    Animated.timing(fade, { toValue: 0, duration: 420, useNativeDriver: true }).start(({ finished }) => {
      if (finished) onStart();
    });
  }

  return (
    <Animated.View style={[styles.root, { opacity: fade }]}>
      {/* 背景图:绝对铺满整屏(显式 SW×SH),保证 cover 把整张图都盖住(含底部钢笔/怀表/信封),
          不依赖 flex 在网页端能否撑满高度 —— 修复 web 上底部被裁掉的问题。
          A7: 纯装饰背景,对屏幕阅读器隐藏 */}
      <Image source={require('@/assets/images/splash-bg.png')} style={styles.bgImage} resizeMode="cover" accessible={false} importantForAccessibility="no-hide-descendants" />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* 上半部分:火漆 logo + Reunite 切图 + 金色分隔线 + 标语 */}
        <Animated.View style={styles.top}>
          {/* A7: 装饰性图片对屏幕阅读器隐藏(logo/wordmark/divider/bgImage 均为纯装饰) */}
          <Image source={require('@/assets/images/seal-stamp.png')} style={styles.logo} resizeMode="contain" accessible={false} importantForAccessibility="no-hide-descendants" />
          <Image source={require('@/assets/images/splash-wordmark.png')} style={styles.wordmark} resizeMode="contain" accessible={false} importantForAccessibility="no-hide-descendants" />
          <Image source={require('@/assets/images/splash-divider.png')} style={styles.divider} resizeMode="contain" accessible={false} importantForAccessibility="no-hide-descendants" />
          <Text style={styles.tagline}>Write to your future self.{'\n'}Meet the person you used to be.</Text>
        </Animated.View>

        {/* 底部:Start 按钮(与写信页同款实心主题色) */}
        <Animated.View style={styles.footer}>
          <Button label="Start" onPress={handleStart} />
        </Animated.View>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  // 背景图绝对铺满整屏(显式 SW×SH),网页端也不会塌高度
  bgImage: { position: 'absolute', top: 0, left: 0, width: SW, height: SH },
  // 上下分布:内容靠上,按钮沉底(中间留白自动撑开)
  safe: { flex: 1, justifyContent: 'space-between' },

  // 上半组:居中,距顶约 12% 屏高
  top: { alignItems: 'center', paddingTop: SH * 0.12 },
  logo: { width: 108, height: 162 },          // 透明火漆(稍微大一点点;原图 2:3,内含上下留白)
  wordmark: { width: 138, height: 40, marginTop: -20 }, // Reunite 切图(再缩小 + 上移靠近 logo)
  divider: { width: 188, height: 11, marginTop: 12 },   // 金色分隔线(227×13)
  tagline: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.brandText, // WCAG AA: 换用更深的 brandText(#84410F)代替 brand(#B26B24),提升照片背景上的对比度。
    textAlign: 'center',
    marginTop: 14,
  },

  // 底部按钮容器:左右页边距更大 → 按钮更窄;离底一点
  footer: { paddingHorizontal: 64, paddingBottom: 56 },
});
