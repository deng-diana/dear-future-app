/**
 * PaperBackground — 给整个屏幕一种真实纸张的质感包裹层
 *
 * 诚实说明:照片级棉纤维纹理需要真实图片素材,这里做的是代码近似版:
 *   1. 象牙白底色 (#EDD8C3)
 *   2. 极淡的暖色颗粒层 — 用 32 个随机定位的小圆点(opacity ≈ 0.018~0.025),
 *      模拟纸浆中细小杂质的感觉。视觉上 2–3% 的"颗粒感"。
 *   3. 边缘内晕(vignette) — 四条细线 semi-透明边框,模拟纸张边缘略暗的效果。
 *   4. 右下角翘边 — 两层叠加(一个 45° 旋转方块 + 一层渐变近似阴影),
 *      比单一方块更接近真实卷角的形态。
 * 所有覆盖层都是 pointerEvents="none",不会遮挡触摸事件。
 */
import React, { useMemo } from 'react';
import { DimensionValue, StyleSheet, View } from 'react-native';

// 预先生成颗粒点位,避免每次 render 重新随机
// 每个点:{ left%, top%, size(px), opacity }
function generateFlecks(count: number) {
  // 用固定种子序列而不是 Math.random(),保证 SSR/热重载时稳定
  // (React Native 没有 SSR,但稳定输出对 reconciler 友好)
  const flecks: { left: DimensionValue; top: DimensionValue; size: number; opacity: number }[] = [];
  // 简单线性同余伪随机 (Linear Congruential Generator — 最简单的伪随机数算法),
  // 不需要真随机,只要分布均匀、可重复。
  let seed = 0x8F4B;
  function rand() {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  }

  for (let i = 0; i < count; i++) {
    flecks.push({
      left: `${(rand() * 92 + 2).toFixed(1)}%` as DimensionValue,   // 2%–94% 避免贴边
      top: `${(rand() * 92 + 2).toFixed(1)}%` as DimensionValue,
      size: rand() < 0.7 ? 1 : 2,                  // 70% 是 1px 点, 30% 是 2px
      opacity: 0.015 + rand() * 0.012,              // 0.015–0.027 — 极淡
    });
  }
  return flecks;
}

const FLECKS = generateFlecks(32);

interface Props {
  children: React.ReactNode;
}

export default function PaperBackground({ children }: Props) {
  // 颗粒节点只计算一次
  const fleckNodes = useMemo(
    () =>
      FLECKS.map((f, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: f.left,
            top: f.top,
            width: f.size,
            height: f.size,
            borderRadius: f.size,           // 圆点
            backgroundColor: '#5A3A24',     // 暖棕色"杂质"
            opacity: f.opacity,
          }}
        />
      )),
    [],
  );

  return (
    <View style={styles.root}>
      {/* ── 主内容:显式 flex:1 容器确保子元素能正确占满剩余高度 ── */}
      <View style={styles.content}>
        {children}
      </View>

      {/* ── 颗粒层:32 个极淡暖色小点,模拟纸浆纤维 ── */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {fleckNodes}
      </View>

      {/* ── 内晕层:四面 semi-透明边框,边缘略暗,模拟纸张四周渐暗 ──
          用四个 1px 宽的条状 View 各贴一边,opacity 叠加出渐暗效果 */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.vignetteOuter]} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.vignetteInner]} />

      {/* ── 翘角:右下角"被掀起的一页"近似效果 ──
          由两层组成:
            curlShadow — 偏移出去、略暗,模拟掀起的页背面投影
            curlFace   — 正面那片,象牙白略深,45° 旋转,探出屏外 */}
      <View pointerEvents="none" style={styles.curlWrap}>
        {/* 投影近似:比正面大一点点,颜色深一点,偏左偏上 */}
        <View style={styles.curlShadow} />
        {/* 掀起的纸面 */}
        <View style={styles.curlFace} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#EDD8C3', // 象牙白底色
  },
  // 内容容器:明确给 flex:1,保证 children(含 KAV flex:1)能正确拿到全部剩余高度。
  // 没有这层包裹时,Yoga 在 children 里同时有 absolute 子视图的情况下可能无法正确分配高度。
  content: {
    flex: 1,
  },

  // 外晕:极淡边框,四周 2px,颜色比纸面稍深一点
  vignetteOuter: {
    borderWidth: 6,
    borderColor: 'rgba(90, 58, 36, 0.03)', // #5A3A24 at 3%
    borderRadius: 0,
  },
  // 内晕:再叠一层,稍厚,更淡
  vignetteInner: {
    borderWidth: 14,
    borderColor: 'rgba(90, 58, 36, 0.015)', // #5A3A24 at 1.5%
    borderRadius: 0,
  },

  // 右下角翘边容器:刚好容纳下两层
  curlWrap: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 72,
    height: 72,
  },

  // 投影层:比 curlFace 大 6px,颜色深,偏左偏上 3px,半透明
  curlShadow: {
    position: 'absolute',
    right: -34,
    bottom: -34,
    width: 66,
    height: 66,
    backgroundColor: '#C9B097',   // 中间调暖褐,比纸面深
    transform: [{ rotate: '45deg' }],
    opacity: 0.22,                 // 约等于 shadowOpacity 0.05 的视觉感
    // 注:RN 的 shadow* 属性只在 iOS 生效且只能用在有背景色的 View 上,
    // 用 opacity 近似能跨平台保持一致
  },

  // 翘起的纸面:象牙色略偏黄(纸的背面),旋转 45°,一半探出屏外
  curlFace: {
    position: 'absolute',
    right: -30,
    bottom: -30,
    width: 60,
    height: 60,
    backgroundColor: '#E3CDB4',   // 比正面 #EDD8C3 略深,像纸背面
    transform: [{ rotate: '45deg' }],
    shadowColor: '#000',
    shadowOpacity: 0.06,           // < 0.08,非常轻
    shadowRadius: 6,
    shadowOffset: { width: -3, height: -3 },
    elevation: 2,                  // Android 投影
  },
});
