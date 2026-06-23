/**
 * colors.ts — 设计令牌:调色板 + 语义角色
 *
 * 两层结构:
 *   palette  — 原始色值(描述性名字 → 精确 hex)
 *   colors   — 语义角色(用途名字 → palette 引用)
 *
 * 规则:每一个 hex 都原封不动保留,不做任何合并或"修正"。
 * 品牌漂移说明见文件底部注释。
 */

// ── 调色板:按色系分组 ────────────────────────────────────────────────────

export const palette = {
  // 奶油/象牙 系 — 背景色族
  creamDeep: '#FAE6C9',    // 主屏幕底色(写信页/封存页/Splash)
  creamMid: '#EDD8C3',     // PaperBackground 底色 / SignIn 屏底色
  creamLight: '#FBF1DF',   // BottomSheet 底单底色
  creamPale: '#FFEBC1',    // SealCeremony 信纸卡片底色
  creamCard: '#F4E7D6',    // AccountButton 弹出卡片底色
  creamText: '#FBEFDB',    // 实心深色按钮上的近白文字

  // 棕/深棕 系 — 文字色族
  brownDark: '#3A2416',    // 最深棕:SignIn 标题/邮件地址文字
  brownDeep: '#5A3A24',    // 底单标题文字(dateHero/sealSheetTitle/monthLabel)
  brownInk: '#67350F',     // 信件正文墨水色(TextInput / Calendar 日期数字)
  brownWarm: '#7A4A1E',    // SealCeremony 信纸投影色

  // 主题色 — 赤陶/品牌橙棕 系
  brand: '#B26B24',        // 主品牌色:按钮背景/Dateline邮戳/日历选中圆/价格高亮
  brandDark: '#84410F',    // 已封存标题文字(比 brand 更深)
  brandDeep: '#67350F',    // (alias brownInk,均是深墨水棕,已在 brownInk 定义)

  // 金/暖金 系 — 强调色
  goldBright: '#E0A93E',   // 分割线金色星 + 金线(dividerLine/dividerStar)
  goldMid: '#DECA9E',      // SealSheet 分割线(中等金)
  goldSoft: '#EFDFC0',     // dateHero 下方极淡分割线
  goldCursor: '#C68A3A',   // 光标/选择色(TextInput selectionColor/cursorColor)

  // 暖红 系 — 危险/破坏性操作
  terracottaDeep: '#B24A18', // Sign Out 文字 / SignIn 错误文字
  bordeauxRed: '#7A1E1E',    // Delete Account 文字(更深的危险红)

  // 灰褐 系 — 静默/禁用/辅助文字
  mutedBrown: '#9A7E5C',   // 静默辅助文字:星期表头/mediaAdd/backLinkText/sealSheetReason
  mutedMid: '#8A7256',     // SignIn hint/cancel 文字
  mutedSoft: '#6B5A4B',    // SealSheet 摘要项文字
  mutedLight: '#B09A80',   // 禁用态文字:日历灰色日期/placeholder/AccountButton label
  mutedPale: '#B8A492',    // mediaCap 斜体文字(最淡静默)

  // 边框/分割/纸张质感 系
  borderMid: '#C9B097',    // 禁用按钮背景色/SignIn 输入框底边/BottomSheet 抓手条
  borderLight: '#D6C7B2',  // 缩略图边框
  surfacePhoto: '#E3CDB4', // 缩略图背景/AccountButton 卡片内分割线/PaperBackground 翘角正面
  paperFleck: '#5A3A24',   // PaperBackground 颗粒小点(极低 opacity 使用)
} as const;

// ── 语义角色层:用途 → palette 引用 ─────────────────────────────────────

export const colors = {
  // 背景
  background: palette.creamDeep,        // 主屏幕背景(写信/Splash/封存/SealCeremony遮罩)
  backgroundPaper: palette.creamMid,    // 纸张质感背景(PaperBackground/SignIn屏)
  surface: palette.creamLight,          // 浮层/底单表面(BottomSheet)
  surfacePaper: palette.creamPale,      // 更浅的纸张卡片(SealCeremony信纸)
  surfaceCard: palette.creamCard,       // 弹出卡片背景(AccountButton)

  // 文字
  textPrimary: palette.brownDark,       // 最深主文字(SignIn标题/AccountButton邮件)
  textHeading: palette.brownDeep,       // 底单标题/日历月份文字
  textBody: palette.brownInk,           // 信件正文/日历日期数字
  textMuted: palette.mutedBrown,        // 静默辅助文字(星期/mediaAdd/backLink等)
  textMutedMid: palette.mutedMid,       // 次级静默文字(SignIn hint/cancel)
  textMutedSoft: palette.mutedSoft,     // 三级静默文字(SealSheet摘要项)
  textMutedLight: palette.mutedLight,   // 禁用/占位文字(日历灰日期/placeholder)
  textMutedPale: palette.mutedPale,     // 最淡静默文字(mediaCap)
  textInverse: palette.creamText,       // 深色按钮上的近白文字

  // 品牌/强调
  brand: palette.brand,                 // 主品牌色(按钮/邮戳/日历选中/价格)
  brandDark: palette.brandDark,         // 封存标题文字(更深品牌色)
  brandWarm: palette.brownWarm,         // 信纸投影暖色(SealCeremony)
  accentGold: palette.goldBright,       // 金色分割线/星
  accentGoldMid: palette.goldMid,       // SealSheet分割线(中等金)
  accentGoldSoft: palette.goldSoft,     // 极淡金色分割线(dateHeroDivider)
  cursor: palette.goldCursor,           // 光标/选区高亮色

  // 危险操作
  danger: palette.terracottaDeep,       // 登出文字/错误文字
  dangerDeep: palette.bordeauxRed,      // 删除账号文字(更深)

  // 禁用状态
  buttonDisabled: palette.borderMid,    // 禁用按钮背景
  border: palette.borderMid,            // 输入框底边/BottomSheet抓手条
  borderLight: palette.borderLight,     // 缩略图边框
  surfacePhoto: palette.surfacePhoto,   // 缩略图背景/卡片分割线/翘角正面
  paperFleck: palette.paperFleck,       // 纸张颗粒点(极低opacity)
} as const;

/*
 * ── BRAND.md 漂移说明(仅供人类决策,代码不使用) ──────────────────────────
 *
 * BRAND.md 定义的理想色值与 app 实际使用的色值存在漂移:
 *
 * 角色              BRAND.md 期望值    app 实际值(本文件)   差异
 * ─────────────────────────────────────────────────────────────────
 * 背景(Ivory)      #F4EEE4            #FAE6C9              更暖/更橙
 * 主品牌色(Bordeaux) #7A1E1E          #B26B24              完全不同(橙棕 vs 深红)
 * 强调金(Gold)     #D6B26E            #E0A93E              更亮/更黄
 * 正文棕(WarmBrown) #5B4638           #5A3A24              接近,略深
 *
 * BRAND.md 里的 #7A1E1E(Bordeaux Red)在 app 里目前只用于
 * "Delete Account"危险文字,而非主按钮。主按钮实际是 #B26B24(赤陶橙棕)。
 *
 * 建议:由产品负责人决定是否把 app 色值往 BRAND.md 靠拢(下一个设计 pass)。
 * 本次 refactor 不改任何色值。
 */
