/**
 * BottomSheet — 从底部滑上来的纸张底单,带"下拉关闭"手势。
 *
 * 为什么不用 reanimated / gesture-handler?
 * - Thankly 那版底单用的是 reanimated + react-native-gesture-handler。Reunite 虽然
 *   package.json 里也列了这两个库,但本项目刻意没装 reanimated 的 babel 插件、根部也没挂
 *   GestureHandlerRootView(SealCeremony 也是只用 RN 内置 Animated)。引入它们就得改 babel、
 *   重启 Metro,还可能弄坏 web 导出 —— 而本项目正跑在 Expo Go 现场 + web 演示里,不能冒这个险。
 * - 所以这里用 RN 内置的 `Animated` + `PanResponder` 复刻同样的观感与行为:同样的圆角、抓手、
 *   遮罩、滑入动画、以及"下拉/快速下滑就关闭"。无新依赖、无 babel 改动、无需重启,iOS / web 都能跑。
 *
 * 关闭行为(所有路径都走 onClose,统一收尾):
 * - 点遮罩、下拉超过阈值、或快速下滑 —— 都调 onClose,由父组件翻 visible。
 * - visible 变 false 时先播滑出动画,动画结束才真正卸载(内部 mounted 状态),避免一关就闪没。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Modal, PanResponder, Platform, Pressable, StyleSheet, View } from 'react-native';

import { colors } from '@/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// 下拉超过屏幕这个比例、或下滑速度超过这个值,松手即关闭(对齐 Thankly 的手感)。
const CLOSE_DISTANCE_RATIO = 0.2;
const CLOSE_VELOCITY = 0.5; // RN PanResponder 的 vy 单位是 px/ms,0.5 ≈ Thankly 的 500 px/s
const ENTER_MS = 300;
const EXIT_MS = 360;

type Props = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export default function BottomSheet({ visible, onClose, children }: Props) {
  // 关闭时保留挂载,等滑出动画播完再卸载。
  const [mounted, setMounted] = useState(visible);

  // 底单的竖直位移:初值在屏幕外(SCREEN_HEIGHT),滑上来到 0。
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  // 遮罩透明度:跟随底单一起淡入淡出(下拉时也会随手减淡)。
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  // 拖拽起手时底单当前所在的 y(让连续拖拽不跳变)。
  const dragStartY = useRef(0);

  // 滑入:底单升到 0,遮罩淡到 1。
  const animateIn = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: ENTER_MS, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 1, duration: ENTER_MS, useNativeDriver: true }),
    ]).start();
  }, [translateY, overlayOpacity]);

  // 滑出:从当前位置落到屏幕外,遮罩淡到 0,播完卸载。
  const animateOut = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: SCREEN_HEIGHT, duration: EXIT_MS, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 0, duration: EXIT_MS, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [translateY, overlayOpacity]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      // 先确保起点在屏幕外,再滑入(下次打开从底部重新升起)。
      translateY.setValue(SCREEN_HEIGHT);
      overlayOpacity.setValue(0);
      animateIn();
    } else if (mounted) {
      animateOut();
    }
    // mounted 故意不进依赖:只在 visible 翻转时驱动动画。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 下拉手势:只允许向下拖,松手按距离/速度决定关还是弹回。
  const panResponder = useRef(
    PanResponder.create({
      // 明显的竖直下滑才接管(横向小抖动不抢手势)。
      onMoveShouldSetPanResponder: (_evt, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        // 记下拖拽起手时底单的位置(通常是 0,但若动画中也能续上)。
        translateY.stopAnimation((v) => {
          dragStartY.current = v;
        });
      },
      onPanResponderMove: (_evt, g) => {
        const next = Math.max(0, dragStartY.current + g.dy); // 只向下
        translateY.setValue(next);
        overlayOpacity.setValue(Math.max(0, 1 - next / SCREEN_HEIGHT));
      },
      onPanResponderRelease: (_evt, g) => {
        const dragged = Math.max(0, dragStartY.current + g.dy);
        const shouldClose = dragged > SCREEN_HEIGHT * CLOSE_DISTANCE_RATIO || g.vy > CLOSE_VELOCITY;
        if (shouldClose) {
          onClose();
        } else {
          animateIn(); // 没到阈值 → 弹回原位
        }
      },
    }),
  ).current;

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      {/* 遮罩:暖调深色,点空白处关闭。 */}
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        {/* 底单本体:从底部升起,只圆上面两角;整块绑下拉手势。 */}
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]} {...panResponder.panHandlers}>
          {/* 顶部居中抓手条,暗示可下滑。 */}
          <View style={styles.handleArea}>
            <View style={styles.handle} />
          </View>
          {children}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // 暖调深色遮罩(不是死黑),底单坐在最底部。
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(45,22,8,0.5)', // 暗暖遮罩,不用纯黑 — 保留 rgba 以便控制透明度
    justifyContent: 'flex-end',
  },
  // 升起的纸张底单:满宽、只圆上面两角、柔和投影。
  sheet: {
    width: '100%',
    backgroundColor: colors.surface, // 暖奶油底单
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingBottom: 36, // 底部宽松呼吸(像安全区)
    paddingHorizontal: 26,
    alignItems: 'center',
    gap: 18,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -8 },
    elevation: 12,
  },
  // 抓手区:给手势一块好按的区域;条本身居中。
  handleArea: { paddingVertical: 8, alignItems: 'center', alignSelf: 'stretch' },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border },
});
