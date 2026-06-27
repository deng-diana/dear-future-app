// tiers.ts — 根据信件内容决定封存档位(纯函数,无副作用)。
//
// 定价决策表(从上到下,第一条满足的规则生效):
//   1. 无媒体 → 永久免费(纯文字胶囊永远免费、不限次数)
//   2. 有媒体 + ≤4 张照片 + 视频 ≤30 秒 → Photos & Short Video $2.99
//   3. 有媒体 + (>4 张照片 OR 视频 >30 秒) → Rich Media $5.99
//
// 这个函数是纯计算——不调网络,不读 state,只看输入 → 返回决策。
// 这样测试起来轻而易举(直接传数字,看返回值)。

import { TIERS, type SealTier } from './purchases';

export interface TierInput {
  photoCount: number;    // 已附加的照片数量
  videoSeconds: number;  // 已附加视频的时长(秒);没有视频就传 0
  freeSealUsed: boolean; // 这个账号的免费封存次数是否已用过
  // TODO: server-authoritative freeSealUsed — v1 里调用方固定传 false,
  //       等 Edge Function(服务器端函数)接好后,再从服务器读取真实值。
}

export interface TierResult {
  tier: SealTier | null; // null = 免费(不需要购买)
  isFree: boolean;       // 是否完全免费
  priceHint: string;     // 显示给用户的价格字符串(e.g. 'Free' / '$2.99')
  tierName: string;      // 档位展示名称(e.g. 'Free' / 'Words')
  reason: string;        // 一句话解释这个定价的原因(显示在付款弹层里)
}

/**
 * tierFor — 根据信件内容计算封存档位。
 *
 * 决策表(顶部优先、逐条匹配):
 *   无媒体                          → Free(永久免费)
 *   有媒体 + ≤4 张 + 视频 ≤30 s       → 'photos' $2.99
 *   有媒体 + (>4 张 OR 视频 >30 s)    → 'video'  $5.99
 */
export function tierFor(input: TierInput): TierResult {
  const { photoCount, videoSeconds } = input;
  const hasMedia = photoCount > 0 || videoSeconds > 0;

  // ── 规则 1:无媒体 → 永久免费 ──
  // 策略(用户决定):纯文字胶囊永远免费、不限次数。文字存 25 年成本极低,
  // 收费只对真正占存储/带宽的媒体(照片/视频)。freeSealUsed 不再影响文字档。
  if (!hasMedia) {
    return {
      tier: null,
      isFree: true,
      priceHint: 'Free',
      tierName: 'Free',
      reason: 'Words are always free.',
    };
  }

  // ── 规则 2:有媒体 + ≤4 张照片 + 视频 ≤30 秒 → Photos & Short Video ──
  if (photoCount <= 4 && videoSeconds <= 30) {
    return {
      tier: 'photos',
      isFree: false,
      priceHint: TIERS.photos.priceHint,
      tierName: TIERS.photos.label,
      reason: 'A keepsake that holds more than words.',
    };
  }

  // ── 规则 3:有媒体 + >4 张照片 OR 视频 >30 秒 → Rich Media ──
  return {
    tier: 'video',
    isFree: false,
    priceHint: TIERS.video.priceHint,
    tierName: TIERS.video.label,
    reason: 'Room for the fuller picture — more photos, a longer film.',
  };
}
