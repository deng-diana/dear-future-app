// 封存仪式动画 — 用户点「封存」后全屏播放,结束后调 onDone()。
// 情感基调:把这一刻交给时间,轻轻松手。慢、庄重、平静。
// 只用 React Native 内置 Animated API,不依赖 reanimated。

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Dimensions, StyleSheet, View } from 'react-native';

import { colors } from '@/theme';

// 屏幕尺寸 — 用来给"信纸"定大小,让它在各种手机上比例一致。
const { width: SW, height: SH } = Dimensions.get('window');

// 信纸的宽高(约 A5 纸的比例,居中放置)。
const PAPER_W = SW * 0.72;
const PAPER_H = PAPER_W * 1.38;

// 火漆 logo 的尺寸(原图 1024×1536,保持比例)。
const SEAL_W = 116;
const SEAL_H = SEAL_W * (1536 / 1024);

type Props = {
  onDone: () => void; // 动画结束后,父组件负责跳到"已封存"屏
};

export default function SealCeremony({ onDone }: Props) {
  // ── 动画值 ─────────────────────────────────────────────────────────────
  // 1. 信纸整体的透明度(0→1 入场,最后随组合 1→0 飘走淡出)
  const paperOpacity = useRef(new Animated.Value(0)).current;

  // 2. 信纸轻轻"长"出来:scale 0.94→1,配合淡入,像纸被轻轻放下(不再用压暗蒙层)
  const paperScale = useRef(new Animated.Value(0.94)).current;

  // 3. 火漆从上方"落下"的位置偏移(translateY);从 -36 落到 0
  const sealTranslateY = useRef(new Animated.Value(-36)).current;

  // 4. 火漆的尺寸缩放:从 1.5 弹性压到 1.0(spring 的反弹感 = 盖章的触感)
  const sealScale = useRef(new Animated.Value(1.5)).current;

  // 5. 火漆透明度:随它落下而淡入(0→1)
  const sealOpacity = useRef(new Animated.Value(0)).current;

  // 6. 整个"信纸 + 火漆"组合的上飘偏移(translateY):0→飘出屏幕上方
  const groupTranslateY = useRef(new Animated.Value(0)).current;

  // 7. 整个组合淡出透明度:1→0(配合上飘,消失)
  const groupOpacity = useRef(new Animated.Value(1)).current;

  // ── 是否已触发 onDone(保证只调一次)──────────────────────────────────
  const doneCalled = useRef(false);

  // A13: 读取系统"减少动画"设置——用 ref 同步给动画 effect
  const reduceMotionRef = useRef(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      reduceMotionRef.current = enabled;
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      reduceMotionRef.current = enabled;
    });
    return () => sub.remove();
  }, []);

  // 动画实例 ref — 用于卸载时停止
  const ceremonyRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    // A13: 减少动画模式 — 用 setTimeout(0) 让 isReduceMotionEnabled Promise 先 resolve
    const timer = setTimeout(() => {
      if (reduceMotionRef.current) {
        // 跳过多秒仪式,立即触发 onDone(封存已写库,此处只是动画)
        if (!doneCalled.current) {
          doneCalled.current = true;
          onDone();
        }
        return;
      }

      // ── 阶段一 (0 – 0.6 s):信纸安静入场 ────────────────────────────────
      // 淡入 + 轻微放大,像纸被稳稳放下。干净,不压暗。
      const phase1 = Animated.parallel([
        Animated.timing(paperOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.spring(paperScale, {
          toValue: 1,
          tension: 60,
          friction: 9,
          useNativeDriver: true,
        }),
      ]);

      // ── 阶段二 (0.7 – 1.4 s):火漆落下并盖章 ───────────────────────────
      //   a) 火漆从 translateY=-36 落到 0(像从高处压下来)
      //   b) 缩放从 1.5 弹性压到 1.0(spring 的微过冲 = 盖章的触感)
      //   c) 火漆随落下淡入
      const phase2 = Animated.parallel([
        Animated.timing(sealTranslateY, {
          toValue: 0,
          duration: 460,
          useNativeDriver: true,
        }),
        Animated.spring(sealScale, {
          toValue: 1,
          tension: 170,
          friction: 7.5,
          useNativeDriver: true,
        }),
        Animated.timing(sealOpacity, {
          toValue: 1,
          duration: 360,
          useNativeDriver: true,
        }),
      ]);

      // ── 阶段三 (1.7 – 3.0 s):信纸上飘并淡出 ───────────────────────────
      // 整个组合缓缓上飘出屏幕,同时透明度归零。像信被时间轻轻接走。
      const phase3 = Animated.parallel([
        Animated.timing(groupTranslateY, {
          toValue: -(SH * 0.62),
          duration: 1300,
          useNativeDriver: true,
        }),
        Animated.timing(groupOpacity, {
          toValue: 0,
          duration: 1100,
          useNativeDriver: true,
        }),
      ]);

      // ── 串联三个阶段,用 delay 隔开 ────────────────────────────────────
      const ceremony = Animated.sequence([
        phase1,
        Animated.delay(120),     // 信纸稳住一瞬,火漆才落
        phase2,
        Animated.delay(420),     // 让用户看到"已封好"的火漆
        phase3,
      ]);

      ceremonyRef.current = ceremony;
      ceremony.start(({ finished }) => {
        if (finished && !doneCalled.current) {
          doneCalled.current = true;
          onDone();
        }
      });
    }, 0);

    // 组件卸载时停掉动画(防止内存泄漏 / 对已卸载组件 setState)
    return () => {
      clearTimeout(timer);
      ceremonyRef.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只在挂载时跑一次

  // ── 渲染 ───────────────────────────────────────────────────────────────
  return (
    // 全屏暖奶油底板:盖住写信界面,与"已封存"屏同色,衔接顺滑
    <View style={styles.overlay}>
      {/* 整个"信纸 + 火漆"组合:一起上飘 + 淡出 */}
      <Animated.View
        style={[
          styles.group,
          {
            opacity: groupOpacity,
            transform: [{ translateY: groupTranslateY }],
          },
        ]}
      >
        {/* 信纸主体:暖色卡片 + 柔和干净投影 */}
        <Animated.View
          style={[
            styles.paper,
            { opacity: paperOpacity, transform: [{ scale: paperScale }] },
          ]}
        >
          {/* 火漆 logo:落下 + 弹性盖章 + 淡入。A7: 纯装饰动画,对屏幕阅读器隐藏 */}
          <Animated.Image
            source={require('@/assets/images/seal-stamp.png')}
            resizeMode="contain"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.seal,
              {
                opacity: sealOpacity,
                transform: [
                  { translateY: sealTranslateY },
                  { scale: sealScale },
                ],
              },
            ]}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 全屏暖奶油遮罩:absolute + 铺满,盖住下层写信界面
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },

  // 动画组:包裹信纸和火漆,整体做上飘
  group: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 信纸:暖色卡片,柔和干净的暖投影(大半径、低透明、向下偏移)
  paper: {
    width: PAPER_W,
    height: PAPER_H,
    backgroundColor: colors.surfacePaper,
    borderRadius: 10,
    shadowColor: colors.brandWarm,  // 暖棕投影(不发灰),靠大半径+低透明做"干净"
    shadowOpacity: 0.1,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 18 },
    elevation: 10,                  // Android 阴影
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',            // 让火漆可以超出信纸边界
  },

  // 火漆 logo:保持原图比例,居中盖在信纸上
  seal: {
    width: SEAL_W,
    height: SEAL_H,
  },
});
