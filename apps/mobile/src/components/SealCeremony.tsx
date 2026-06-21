// 封存仪式动画 — 用户点「封存」后全屏播放,结束后调 onDone()。
// 情感基调:把这一刻交给时间,轻轻松手。慢、庄重、平静。
// 只用 React Native 内置 Animated API,不依赖 reanimated。

import { useEffect, useRef } from 'react';
import { Animated, Dimensions, StyleSheet, Text, View } from 'react-native';

// 屏幕尺寸 — 用来给"信纸"定大小,让它在各种手机上比例一致。
const { width: SW, height: SH } = Dimensions.get('window');

// 信纸的宽高(约 A5 纸的比例,居中放置)。
const PAPER_W = SW * 0.72;
const PAPER_H = PAPER_W * 1.38;

// 蜡封圆圈的直径。
const SEAL_SIZE = 72;

type Props = {
  onDone: () => void; // 动画结束后,父组件负责跳到"已封存"屏
};

export default function SealCeremony({ onDone }: Props) {
  // ── 动画值 ─────────────────────────────────────────────────────────────
  // 1. 信纸整体的透明度(0→1 入场,最后 1→0 飘走淡出)
  const paperOpacity = useRef(new Animated.Value(0)).current;

  // 2. 信纸变暗:一层半透明深色蒙层,opacity 0→0.18(轻微压暗,像落影)
  const paperDimOpacity = useRef(new Animated.Value(0)).current;

  // 3. 蜡封从上方"落下"的位置偏移(translateY);从 -40 落到 0
  const sealTranslateY = useRef(new Animated.Value(-40)).current;

  // 4. 蜡封的尺寸缩放:从 1.6 压下来到 1.0,带轻微反弹(像盖章的触感)
  const sealScale = useRef(new Animated.Value(1.6)).current;

  // 5. 蜡封上金色 ✦ 的透明度:随蜡封落下而淡入
  const starOpacity = useRef(new Animated.Value(0)).current;

  // 6. 整个"信纸 + 蜡封"组合的上飘偏移(translateY):0→-SH*0.55(飘出屏幕上方)
  const groupTranslateY = useRef(new Animated.Value(0)).current;

  // 7. 整个组合淡出透明度:1→0(配合上飘,消失)
  const groupOpacity = useRef(new Animated.Value(1)).current;

  // ── 是否已触发 onDone(保证只调一次)──────────────────────────────────
  const doneCalled = useRef(false);

  useEffect(() => {
    // ── 阶段一 (0 – 0.6 s):信纸安静入场 ────────────────────────────────
    // 信纸从完全透明淡入到不透明(0→1),同时纸面轻微变暗(蒙层 0→0.18)。
    const phase1 = Animated.parallel([
      Animated.timing(paperOpacity, {
        toValue: 1,
        duration: 500,         // 0.5 s 淡入
        useNativeDriver: true,
      }),
      Animated.timing(paperDimOpacity, {
        toValue: 0.18,
        duration: 600,         // 稍慢,让"压暗"更自然
        useNativeDriver: true,
      }),
    ]);

    // ── 阶段二 (0.6 – 1.4 s):蜡封落下并盖章 ───────────────────────────
    // 两个动画并行:
    //   a) 蜡封从 translateY=-40 落到 0(像从高处掉下来)
    //   b) 蜡封缩放从 1.6 弹性压到 1.0(spring 的反弹感 = 章落的触感)
    //   c) 金色星形随蜡封落定淡入
    const phase2 = Animated.parallel([
      // a) 落位
      Animated.timing(sealTranslateY, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
      // b) 盖章弹性缩放(spring = 弹簧物理,会有微小过冲再回正,像真的在按)
      Animated.spring(sealScale, {
        toValue: 1,
        tension: 180,   // 弹力;越大弹得越快
        friction: 8,    // 阻尼;越小弹得越久/振幅越大
        useNativeDriver: true,
      }),
      // c) 星形淡入(从 0.4 s 延迟开始,等蜡封快落稳了才显)
      Animated.sequence([
        Animated.delay(300),
        Animated.timing(starOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
    ]);

    // ── 阶段三 (1.4 – 2.7 s):信纸上飘并淡出 ───────────────────────────
    // 整个组合(信纸 + 蜡封)缓缓上飘出屏幕,同时透明度归零。
    // easeIn feel:开始很慢,像信被时间轻轻接走。
    const phase3 = Animated.parallel([
      Animated.timing(groupTranslateY, {
        toValue: -(SH * 0.6),  // 飘到屏幕上方 60%,完全消失在视线外
        duration: 1300,
        useNativeDriver: true,
      }),
      Animated.timing(groupOpacity, {
        toValue: 0,
        duration: 1100,         // 比上飘稍短,让消失比到顶先完成一点
        useNativeDriver: true,
      }),
    ]);

    // ── 串联三个阶段,用 delay 隔开 ────────────────────────────────────
    const ceremony = Animated.sequence([
      phase1,
      Animated.delay(80),      // 0.08 s 停顿:信纸稳住一瞬,蜡封才落
      phase2,
      Animated.delay(350),     // 0.35 s 停顿:让用户看到"已封好"的蜡封
      phase3,
    ]);

    ceremony.start(({ finished }) => {
      // finished = true 表示动画完整走完(没被 stop 打断)
      if (finished && !doneCalled.current) {
        doneCalled.current = true;
        onDone();
      }
    });

    // 组件卸载时停掉动画(防止内存泄漏 / 对已卸载组件 setState)
    return () => {
      ceremony.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只在挂载时跑一次

  // ── 渲染 ───────────────────────────────────────────────────────────────
  return (
    // 全屏象牙色底板:盖住写信界面
    <View style={styles.overlay}>

      {/* 整个"信纸 + 蜡封"组合:一起上飘 + 淡出 */}
      <Animated.View
        style={[
          styles.group,
          {
            opacity: groupOpacity,
            transform: [{ translateY: groupTranslateY }],
          },
        ]}
      >

        {/* 信纸主体 */}
        <Animated.View
          style={[
            styles.paper,
            { opacity: paperOpacity },
          ]}
        >
          {/* 轻微变暗的蒙层(叠在信纸上面,不挡子元素) */}
          <Animated.View
            pointerEvents="none"
            style={[styles.paperDim, { opacity: paperDimOpacity }]}
          />

          {/* 蜡封:落下 + 弹性缩放 */}
          <Animated.View
            style={[
              styles.sealWrap,
              {
                transform: [
                  { translateY: sealTranslateY },
                  { scale: sealScale },
                ],
              },
            ]}
          >
            {/* 波尔多红圆圈 */}
            <View style={styles.sealCircle}>
              {/* 金色北极星 ✦ */}
              <Animated.Text style={[styles.star, { opacity: starOpacity }]}>
                ✦
              </Animated.Text>
            </View>
          </Animated.View>
        </Animated.View>

      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 全屏象牙色遮罩:absolute + 铺满,盖住下层写信界面
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#EDD8C3',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },

  // 动画组:包裹信纸和蜡封,整体做上飘
  group: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 信纸:温暖的纸色,带一丝阴影,边角略带弧度
  paper: {
    width: PAPER_W,
    height: PAPER_H,
    backgroundColor: '#F4E7D6',   // 比象牙背景再亮一点点,像真实纸张
    borderRadius: 6,
    shadowColor: '#5A3A24',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,                 // Android 阴影
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',          // 让蜡封可以超出信纸边界
  },

  // 信纸变暗蒙层:绝对铺满信纸,深暖色
  paperDim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#3A2416',
    borderRadius: 6,
  },

  // 蜡封容器:居中摆放,让 spring 缩放锚点在中心
  sealWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 波尔多红蜡封圆圈
  sealCircle: {
    width: SEAL_SIZE,
    height: SEAL_SIZE,
    borderRadius: SEAL_SIZE / 2,
    backgroundColor: '#9B3C10',   // 品牌色:波尔多红
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#572007',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },

  // 金色北极星字形
  star: {
    fontSize: 28,
    color: '#E0A93E',             // 品牌色:古金色
    lineHeight: 32,               // 让 ✦ 在圆圈里垂直居中
  },
});
