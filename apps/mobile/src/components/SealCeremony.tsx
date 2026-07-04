// SealCeremony — 两幕封存仪式,总长 ≈ 4.1 s(创始人终版)。
//
// 第 1 幕 (~0–1.3 s):信封居中淡入(封口立着:rotateX ≈ 178°,三角朝上)
//   → 封口从上向下折合(rotateX → 0°,双倍高容器技巧模拟顶边铰链,inOut-cubic 600 ms)。
//
// 第 2 幕 (~1.75–2.5 s):火漆印从上方落下、弹簧压进封口尖(scale 1.5→1)
//   → 落定:触觉反馈(Medium)+ 酒红挤压圈晕开 + 信封 2px 微颤。
//
// 尾声:750 ms 神圣停顿(什么都不动)→ 信封向上远去、轻微缩小、淡出(1.2 s)
//   → onDone()。封存即离开 —— 产品哲学;随后的已封存屏自上而下浮现,像归来的预告。
//
// ⚠️ 引擎:核心 RN Animated(useNativeDriver)。此前的 reanimated v4 版本在本 App
// 的运行环境里 worklet 不驱动(全片停在初始透明 → 白屏后直跳),而 Splash/BottomSheet/
// 已封存屏的核心 Animated 均被验证可用 —— 遂统一到核心引擎,消除这个变量。
// Reduce-motion:直接跳到 onDone。公开 API:{ onDone: () => void } 不变。

import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors } from '@/theme';

// ── Geometry ──────────────────────────────────────────────────────────────────

// Envelope: aspect ratio mirrors sealed-envelope.png (120 × 79 ≈ 1.52 : 1).
const ENV_W = 200;
const ENV_H = Math.round((ENV_W * 79) / 120); // = 132

// Flap: V-tip at ~42 % from top matches the sealed PNG's fold crease position.
const FLAP_H = Math.round(ENV_H * 0.42); // = 55

// Pack = the envelope composition (no letter paper in this design).
const PACK_W = ENV_W;
const PACK_H = ENV_H;

// Seal stamp. The asset is portrait (≈ 2 : 3); resizeMode="contain" fills the box.
const STAMP_W = 50;
const STAMP_H = Math.round(STAMP_W * 1.5); // = 75
const STAMP_X = (PACK_W - STAMP_W) / 2;
const STAMP_Y = Math.round(FLAP_H - STAMP_H / 2);

// Wax squish ring (oval, slightly wider than tall).
const SQUISH_W = 76;
const SQUISH_H = 46;
const SQUISH_X = (PACK_W - SQUISH_W) / 2;
const SQUISH_Y = Math.round(FLAP_H - SQUISH_H / 2);

// Z-index layers.
const Z_ENV_FRONT = 4;
const Z_FLAP      = 5;
const Z_SQUISH    = 6;
const Z_SEAL      = 7;

// Departure(封存即离开):向上飞出 + 远去缩小。
const DEPART_TRANSLATE_Y = -340;
const DEPART_SCALE       = 0.92;

// ── Timeline (ms) ─────────────────────────────────────────────────────────────
// T=0050 信封淡入(300ms)→ T=0700 封口折合(600ms)→ T=1750 火漆下落(380ms)
// → T=2130 落定(触感+挤压圈+微颤)→ T=2880 启程(1200ms)→ T=4080 onDone
const T_ENV      = 50;
const DUR_ENV    = 300;
const T_FLAP     = 700;
const DUR_FLAP   = 600;
const T_STAMP    = 1750;
const DUR_DROP   = 380;
const T_SETTLE   = T_STAMP + DUR_DROP; // = 2130
const DUR_PAUSE  = 750;
const T_DEPART   = T_SETTLE + DUR_PAUSE; // = 2880
const DUR_DEPART = 1200;
const T_DONE     = T_DEPART + DUR_DEPART; // = 4080

type Props = { onDone: () => void };

export default function SealCeremony({ onDone }: Props) {
  // ── Animated values(核心 Animated;全部走 native driver)────────────────
  const packOpacity = useRef(new Animated.Value(0)).current;
  const packEnterY  = useRef(new Animated.Value(8)).current;
  const packScale   = useRef(new Animated.Value(0.97)).current; // 入场 0.97→1;启程 →0.92
  const packJoltY   = useRef(new Animated.Value(0)).current;
  const packDepartY = useRef(new Animated.Value(0)).current;

  const flapRot = useRef(new Animated.Value(178)).current; // 178=敞开(朝上) → 0=合上

  const sealOpacity = useRef(new Animated.Value(0)).current;
  const sealDropY   = useRef(new Animated.Value(-40)).current;
  const sealScale   = useRef(new Animated.Value(1.5)).current;

  const squishScale   = useRef(new Animated.Value(0.5)).current;
  const squishOpacity = useRef(new Animated.Value(0)).current;

  const doneCalled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = () => {
      if (!doneCalled.current && !cancelled) {
        doneCalled.current = true;
        onDone();
      }
    };

    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) {
        finish(); // 减少动画:跳过仪式
        return;
      }

      const easeOut = Easing.out(Easing.cubic);
      const easeInOut = Easing.inOut(Easing.cubic);
      const departEase = Easing.bezier(0.6, 0.04, 0.3, 1);

      // 第 1 幕a — 信封淡入落定
      Animated.parallel([
        Animated.timing(packOpacity, { toValue: 1, duration: DUR_ENV, delay: T_ENV, easing: easeOut, useNativeDriver: true }),
        Animated.timing(packEnterY,  { toValue: 0, duration: DUR_ENV, delay: T_ENV, easing: easeOut, useNativeDriver: true }),
        Animated.timing(packScale,   { toValue: 1, duration: DUR_ENV, delay: T_ENV, easing: easeOut, useNativeDriver: true }),
      ]).start();

      // 第 1 幕b — 封口从上向下折合
      Animated.timing(flapRot, { toValue: 0, duration: DUR_FLAP, delay: T_FLAP, easing: easeInOut, useNativeDriver: true }).start();

      // 第 2 幕 — 火漆:出现 + 下落 + 弹簧压印
      Animated.timing(sealOpacity, { toValue: 1, duration: 200, delay: T_STAMP, easing: easeOut, useNativeDriver: true }).start();
      Animated.timing(sealDropY, { toValue: 0, duration: DUR_DROP, delay: T_STAMP, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
      Animated.sequence([
        Animated.delay(T_STAMP),
        Animated.spring(sealScale, { toValue: 1, damping: 13, stiffness: 260, mass: 1, useNativeDriver: true }),
      ]).start();

      // 落定帧:触觉 + 挤压圈 + 微颤(定时器对齐 T_SETTLE)
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          Animated.parallel([
            Animated.timing(squishOpacity, { toValue: 0.5, duration: 60, useNativeDriver: true }),
            Animated.timing(squishScale, { toValue: 1.2, duration: 420, easing: easeOut, useNativeDriver: true }),
          ]).start(() => {
            Animated.timing(squishOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start();
          });
          Animated.sequence([
            Animated.timing(packJoltY, { toValue: 2, duration: 80, useNativeDriver: true }),
            Animated.timing(packJoltY, { toValue: 0, duration: 160, useNativeDriver: true }),
          ]).start();
        }, T_SETTLE),
      );

      // 尾声 — 神圣停顿后,信封向上远去、缩小、淡出(封存即离开)。
      // ⚠️ 必须用 setTimeout 延后 .start():packOpacity/packScale 在入场时各有
      // 一个动画在跑,core Animated 里对同一个值再次 .start()(哪怕带 delay)
      // 会立刻掐掉前一个 —— 之前整场白屏的根因就是入场动画被这里同步掐死。
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          Animated.parallel([
            Animated.timing(packDepartY, { toValue: DEPART_TRANSLATE_Y, duration: DUR_DEPART, easing: departEase, useNativeDriver: true }),
            Animated.timing(packScale,   { toValue: DEPART_SCALE,       duration: DUR_DEPART, easing: departEase, useNativeDriver: true }),
            Animated.timing(packOpacity, { toValue: 0,                  duration: DUR_DEPART, easing: departEase, useNativeDriver: true }),
          ]).start();
        }, T_DEPART),
      );

      timers.push(setTimeout(finish, T_DONE));
    });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 封口旋转:数值 → 角度字符串(核心 Animated 用 interpolate 做)。
  const flapRotDeg = flapRot.interpolate({ inputRange: [0, 178], outputRange: ['0deg', '178deg'] });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.overlay}>
      <Animated.View
        style={[
          styles.pack,
          {
            opacity: packOpacity,
            transform: [
              { translateY: Animated.add(packEnterY, Animated.add(packJoltY, packDepartY)) },
              { scale: packScale },
            ],
          },
        ]}>
        {/* 信封底(口袋内衬色),最底层。 */}
        <View style={styles.envBack} />

        {/* 封口:双倍高容器模拟「顶边铰链」—— 容器中心 = 折线 = 信封顶边。
            perspective 必须排在 transform 数组第一位。
            178°(敞开)时三角镜像朝上立在信封上方;0°(合上)时盖住顶部成 V 形。 */}
        <Animated.View
          style={[
            styles.flapWrap,
            { transform: [{ perspective: 700 }, { rotateX: flapRotDeg }] },
          ]}>
          <View style={styles.flapSpacer} />
          <View style={styles.flapClip}>
            <View style={styles.flapTriangle} />
          </View>
        </Animated.View>

        {/* 信封正面(主可见面)+ 底部折线的极淡 V 形折痕。 */}
        <View style={styles.envFront}>
          <View style={styles.vFoldTriangle} />
        </View>

        {/* 蜡的挤压圈:落定瞬间晕开淡去。 */}
        <Animated.View
          accessible={false}
          style={[
            styles.squish,
            { left: SQUISH_X, top: SQUISH_Y, zIndex: Z_SQUISH },
            { opacity: squishOpacity, transform: [{ scale: squishScale }] },
          ]}
        />

        {/* 火漆印:从上落下、弹簧压进封口尖。 */}
        <Animated.Image
          source={require('@/assets/images/seal-stamp.png')}
          resizeMode="contain"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.seal,
            { left: STAMP_X, top: STAMP_Y, zIndex: Z_SEAL },
            { opacity: sealOpacity, transform: [{ translateY: sealDropY }, { scale: sealScale }] },
          ]}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 全屏米白幕布,构图居中。
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },

  pack: {
    width:  PACK_W,
    height: PACK_H,
  },

  envBack: {
    position: 'absolute',
    left: 0, top: 0,
    width: ENV_W, height: ENV_H,
    backgroundColor: colors.envelopeDeep,
    borderRadius: 5,
  },

  flapWrap: {
    position: 'absolute',
    left: 0,
    top:  -FLAP_H, // 容器中心 = 折线 = 信封顶边
    width:  ENV_W,
    height: FLAP_H * 2,
    zIndex: Z_FLAP,
  },
  flapSpacer: { height: FLAP_H }, // 透明上半:把视觉铰链挪到容器中心
  flapClip: {
    width:    ENV_W,
    height:   FLAP_H,
    overflow: 'hidden',
  },
  flapTriangle: {
    position: 'absolute',
    width: 0, height: 0,
    top:  FLAP_H,
    left: 0,
    borderLeftWidth:  ENV_W / 2,
    borderRightWidth: ENV_W / 2,
    borderTopWidth:   FLAP_H,
    borderTopColor:   colors.envelope,
    borderLeftColor:  'transparent',
    borderRightColor: 'transparent',
  },

  envFront: {
    position: 'absolute',
    left: 0, top: 0,
    width: ENV_W, height: ENV_H,
    backgroundColor: colors.envelope,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
    zIndex: Z_ENV_FRONT,
    // 暖棕投影,不用黑。
    shadowColor:   colors.brandWarm,
    shadowOpacity: 0.18,
    shadowRadius:  14,
    shadowOffset:  { width: 0, height: 8 },
  },
  // 底部折线的极淡 V 折痕(与合上的封口三角组成经典信封菱形)。
  vFoldTriangle: {
    position: 'absolute',
    width: 0, height: 0,
    top:  FLAP_H,
    left: 0,
    borderLeftWidth:   ENV_W / 2,
    borderRightWidth:  ENV_W / 2,
    borderBottomWidth: ENV_H - FLAP_H,
    borderBottomColor: colors.envelopeDeep,
    borderLeftColor:   'transparent',
    borderRightColor:  'transparent',
    opacity: 0.22,
  },

  squish: {
    position: 'absolute',
    width:        SQUISH_W,
    height:       SQUISH_H,
    borderRadius: SQUISH_H / 2,
    backgroundColor: colors.dangerDeep,
  },

  seal: {
    position: 'absolute',
    width:  STAMP_W,
    height: STAMP_H,
  },
});
