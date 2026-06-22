// ============================================================
// purchases.ts — RevenueCat (应用内购买) 服务封装
//
// RevenueCat 是第三方付款 SDK:它帮我们跟 App Store / Google Play
// 说话,处理收据、防重复购买、退款等细节。
//
// 这个文件是"地基"——只安装好管道,还没接进封存流程。
// 等免费档位规则定了再接(见下方 TODO)。
//
// TODO(follow-ups):
//   (a) 在 .env 里填写真实的 EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
//       和 EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY
//       (从 RevenueCat 控制台 app.revenuecat.com 拿到)。
//   (b) 在 RevenueCat 控制台 + App Store Connect / Google Play Console
//       创建产品 & Offering(产品目录),让 getOfferings() 能拿到真实数据。
//   (c) 等免费档位规则定稿后,把 purchaseTier() 接入封存流程
//       (apps/mobile/src/app/index.tsx 的 handleSeal)。
//   (d) [高风险,单独任务] 在服务器端(Supabase Edge Function)
//       校验购买凭证后再放行封存——客户端结果不可信。
// ============================================================

import { Platform } from 'react-native';
// 注意:react-native-purchases 在 web 环境下有 browser stub(浏览器占位模块),
// 但某些方法仍可能抛错。所以我们在每个函数里都先检查平台 + 密钥,
// 确保 web / Expo Go(无密钥) 完全走 no-op(不做任何事)路径。
import Purchases, { PURCHASES_ERROR_CODE } from 'react-native-purchases';
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';

// ──────────────────────────────────────────────────────────────
// 密钥 & 平台检测
// ──────────────────────────────────────────────────────────────

// EXPO_PUBLIC_* 前缀的环境变量会在构建时被 Expo 打包进 app。
// iOS 和 Android 用不同的 RevenueCat API Key(应用程序接口密钥)。
// API = Application Programming Interface,就是"两个软件对话的接口"。
const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? '';
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? '';

// 当前平台对应的密钥(web 平台给空字符串)。
function platformKey(): string {
  if (Platform.OS === 'ios') return IOS_KEY;
  if (Platform.OS === 'android') return ANDROID_KEY;
  return ''; // web 或其他平台
}

// 是否已具备运行条件:不是 web + 有密钥。
function isEnabled(): boolean {
  if (Platform.OS === 'web') return false;
  return platformKey().length > 0;
}

// 只在开发模式下警告一次(不打扰线上用户)。
let _warnedOnce = false;
function devWarnOnce(): void {
  if (__DEV__ && !_warnedOnce) {
    _warnedOnce = true;
    console.warn(
      '[purchases] RevenueCat API Key(应用内购买密钥)未配置。' +
      '在 .env 里设置 EXPO_PUBLIC_REVENUECAT_IOS_API_KEY / ' +
      'EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY 后重启 Metro(打包服务器)。'
    );
  }
}

// ──────────────────────────────────────────────────────────────
// 套餐层级定义
// ──────────────────────────────────────────────────────────────

// SealTier = 封存档位。每个档位对应一个一次性消耗品(Consumable,买了就用掉)。
// "消耗品"跟订阅不同:买了不能用来判断用户状态——
// 实际福利由服务器端在收到购买凭证后授予(见 TODO d)。
export type SealTier = 'words' | 'photos' | 'video';

export interface TierDefinition {
  // RevenueCat Offering(产品目录)里对应的 Package Identifier(套餐标识符)。
  // 注意:这不是 App Store / Google Play 的原始产品 ID——
  // RevenueCat 在中间做了映射,真实 Store 产品 ID 在 RevenueCat 控制台配置。
  packageId: string;
  // 展示给用户看的名称。
  label: string;
  // 价格提示(占位文本;真实价格从 RevenueCat SDK 的 product.priceString 读取)。
  priceHint: string;
  // 这个档位包含的功能描述(一句话)。
  description: string;
}

// TIERS = 所有档位的常量表。
// 档位从低到高:words(纯文字)→ photos(文字+照片+视频)→ video(更丰富媒体)。
// 名字用大白话、自带说明,对非英语母语者友好(用户在付款弹窗看到的就是这些)。
export const TIERS: Record<SealTier, TierDefinition> = {
  words: {
    packageId: '$rc_words',       // 在 RevenueCat 控制台里配置成同名 Package
    label: 'Words',
    priceHint: '$2.99',
    description: 'Your letter, sealed in time.',
  },
  photos: {
    packageId: '$rc_photos',
    label: 'Words & Photos',
    priceHint: '$4.99',
    description: 'Add up to 4 photos and a short video.',
  },
  video: {
    packageId: '$rc_video',
    label: 'Words, Photos & Video',
    priceHint: '$9.99',
    description: 'More photos and a longer, sharper video.',
  },
};

// ──────────────────────────────────────────────────────────────
// 对外导出的三个函数
// ──────────────────────────────────────────────────────────────

/**
 * configurePurchases — 初始化 RevenueCat SDK。
 *
 * 在 app 启动时调用一次(例如放在根组件的 useEffect 里)。
 * web / 无密钥时静默跳过,不抛错。
 */
export async function configurePurchases(): Promise<void> {
  // web 或无密钥 → 跳过。
  if (!isEnabled()) {
    devWarnOnce();
    return;
  }
  try {
    Purchases.configure({ apiKey: platformKey() });
  } catch (e) {
    // 配置失败不崩 app——封存流程后续会因 getOfferings 返回 null 而走免费路径。
    console.warn('[purchases] configure 失败:', e);
  }
}

/**
 * getOfferings — 拉取 RevenueCat 当前的产品目录(Offerings)。
 *
 * Offerings = RevenueCat 控制台里配置的"产品套装"。
 * 返回 current Offering(当前推荐套装),或 null(web / 无密钥 / 出错)。
 */
export async function getOfferings(): Promise<PurchasesOffering | null> {
  if (!isEnabled()) return null;
  try {
    const offerings = await Purchases.getOfferings();
    // current = RevenueCat 控制台标记为"当前"的那个 Offering。
    return offerings.current ?? null;
  } catch (e) {
    console.warn('[purchases] getOfferings 失败:', e);
    return null;
  }
}

// purchaseTier 的返回值类型。
export interface PurchaseResult {
  ok: boolean;
  cancelled?: boolean; // 用户自己取消了(点了"不买")
  error?: string;      // 其他错误的文字描述
}

/**
 * purchaseTier — 触发指定档位的购买弹窗。
 *
 * 流程:
 *   1. 拉取 Offerings(产品目录)。
 *   2. 在 current Offering 里找到对应档位的 Package(套餐)。
 *   3. 调用 Purchases.purchasePackage() 弹出系统付款界面。
 *   4. 成功 → { ok: true }。
 *      用户取消 → { ok: false, cancelled: true }。
 *      其他错误 → { ok: false, error: '...' }。
 *
 * 重要:这些是消耗品(Consumables),不用 Entitlements(权益)判断。
 * 真实福利由服务器端收到购买凭证后授予——客户端返回 ok:true 只是"付款成功",
 * 不代表封存已被服务器批准(见 TODO d)。
 *
 * web / 无密钥时返回 { ok: false, error: 'purchases disabled' }。
 */
export async function purchaseTier(tier: SealTier): Promise<PurchaseResult> {
  // web 或无密钥 → 不能购买。
  if (!isEnabled()) {
    return { ok: false, error: 'purchases disabled' };
  }

  // 找到这个档位对应的 RevenueCat Package Identifier。
  const { packageId } = TIERS[tier];

  let pkg: PurchasesPackage | undefined;
  try {
    const offering = await getOfferings();
    if (!offering) {
      return { ok: false, error: 'no offering available' };
    }
    // availablePackages = 这个 Offering 里所有可买的套餐列表。
    pkg = offering.availablePackages.find((p) => p.identifier === packageId);
    if (!pkg) {
      return { ok: false, error: `package "${packageId}" not found in current offering` };
    }
  } catch (e) {
    return { ok: false, error: String(e) };
  }

  // 触发付款。
  try {
    await Purchases.purchasePackage(pkg);
    return { ok: true };
  } catch (e: unknown) {
    // RevenueCat 把错误当 object 抛出,带 code 和 userCancelled 字段。
    // userCancelled = 用户自己点了"不买"。
    const err = e as { code?: string; userCancelled?: boolean | null; message?: string };

    // 判断取消:新版用 code === PURCHASE_CANCELLED_ERROR,旧版有 userCancelled 字段。
    // PURCHASE_CANCELLED_ERROR = "1" (来自 PURCHASES_ERROR_CODE 枚举)。
    const wasCancelled =
      err.userCancelled === true ||
      err.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;

    if (wasCancelled) {
      return { ok: false, cancelled: true };
    }
    return { ok: false, error: err.message ?? String(e) };
  }
}
