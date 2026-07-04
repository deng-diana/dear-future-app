/**
 * Button.tsx — 共享按钮基础组件
 *
 * 两种变体(variant):
 *   'solid' — 实心主题色背景 + 近白文字(主 CTA,例如 Seal / Start / Send code)
 *   'link'  — 无背景纯文字点击区(次要操作,例如 ← Keep writing / Not now)
 *
 * 为什么要这个组件?
 *   index.tsx / SignIn.tsx / Splash.tsx 各自手写了几乎相同的 Pressable + StyleSheet,
 *   这里把共性提取出来,统一用设计令牌,消除重复。
 */

import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  ViewStyle,
} from 'react-native';

import { colors, fonts } from '@/theme';

type Props = {
  // 'solid' = 实心背景按钮(默认),'link' = 纯文字点击区
  variant?: 'solid' | 'link';
  // 按下时的回调
  onPress: () => void;
  // 按钮文字(loading 为 true 时不显示,改显示转圈)
  label: string;
  // 禁用:变灰、不响应点击
  disabled?: boolean;
  // 加载中:显示转圈代替文字(同时也隐式 disabled)
  loading?: boolean;
  // 外部可传布局覆盖(margin / width / alignSelf 等);不覆盖内部颜色逻辑
  style?: StyleProp<ViewStyle>;
  // 文字样式覆盖(fontSize / letterSpacing 等微调)
  textStyle?: StyleProp<TextStyle>;
};

export default function Button({
  variant = 'solid',
  onPress,
  label,
  disabled = false,
  loading = false,
  style,
  textStyle,
}: Props) {
  // loading 期间也视同 disabled(防重复触发)
  const isDisabled = disabled || loading;

  if (variant === 'link') {
    // 'link' 变体:无背景,纯文字,只有点击区内边距
    return (
      <Pressable
        onPress={onPress}
        disabled={isDisabled}
        style={[styles.linkHitArea, style]}
        accessibilityRole="button">
        <Text style={[styles.linkText, isDisabled && styles.linkTextDisabled, textStyle]}>
          {label}
        </Text>
      </Pressable>
    );
  }

  // 'solid' 变体:实心主题色按钮
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={[
        styles.solid,
        isDisabled && styles.solidDisabled,
        style,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}>
      {loading ? (
        // 加载中显示转圈(与原 ActivityIndicator 颜色一致)
        <ActivityIndicator color={colors.textInverse} />
      ) : (
        <Text style={[styles.solidText, textStyle]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // ── solid 变体 ──────────────────────────────────────────────────────────
  solid: {
    backgroundColor: colors.brandButton,  // 按钮专用背景(比 brand 稍深,确保近白文字 ≥4.5:1 AA)
    paddingVertical: 13,                  // 13+13+~20 text ≈ 46pt, above the 44pt Apple HIG minimum
    paddingHorizontal: 40,
    borderRadius: 0,                   // 直角(品牌规范:不要圆角)
    alignItems: 'center',
    alignSelf: 'stretch',             // 默认撑满父容器宽度(call site 可通过 style 覆盖)
  },
  solidDisabled: {
    backgroundColor: colors.buttonDisabled, // 禁用态:暖灰(与原 sealButtonDisabled 一致)
  },
  solidText: {
    fontFamily: fonts.regular,        // Courier Prime
    color: colors.textInverse,        // 近白文字
    fontSize: 16,
    letterSpacing: 0.5,
  },

  // ── link 变体 ───────────────────────────────────────────────────────────
  linkHitArea: {
    // 保留与原 backLink 样式一致的点击区内边距,手指更好点到
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  linkText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted, // 静默暖灰(与原 backLinkText 一致)
  },
  linkTextDisabled: {
    opacity: 0.4, // 禁用时轻微褪色(loading 期间 link 按钮几乎不会被 disabled,但备着)
  },
});
