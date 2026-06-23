/**
 * typography.ts — 字体常量
 *
 * 只收录 app 实际加载并使用的字体族名(必须与 useFonts 里的 key 完全一致)。
 * 组件从这里引入字符串,而不是到处硬写字体名。
 */

export const fonts = {
  // Courier Prime — 全站主字体(打字机风格)
  regular: 'CourierPrime_400Regular',
  bold:    'CourierPrime_700Bold',

  // IBM Plex Mono — 备用等宽字体(已加载,待用)
  monoMedium: 'IBMPlexMono_500Medium',
} as const;
