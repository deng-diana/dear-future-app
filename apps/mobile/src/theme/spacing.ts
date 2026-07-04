/**
 * theme/spacing.ts — 间距令牌(4 的倍数标尺)
 *
 * 用法:import { spacing } from '@/theme'
 * 规则:所有 margin / padding / gap 从这里取,不写裸数字 ——
 * 想全局调密度,只改这一处。
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;
