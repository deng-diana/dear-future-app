// 邀请用户评价 —— 业内最佳实践:在情绪最高点(封存完成)请求,且一生只问一次。
//
// 两层实现,同一段代码在新旧包里都正确:
//  ① 原生评分弹窗(expo-store-review):App 内直接点星,体验最好、转化最高。
//     需要带该原生模块的 build(build 17+);系统自动限频(每用户每年最多 3 次)。
//  ② 兜底(build 16 走 OTA 时):温和的 Alert → 跳 App Store 写评论页。
//     直接跳转会突兀,所以先问一句;纯 JS,可随 OTA 下发。
//
// ⚠️ 新架构陷阱(见 memory:视频压缩):不能用 NativeModules.X 判断原生模块在不在,
// 要直接 require 包本身 —— 原生侧缺失时 require 在运行时抛错,用 try/catch 接住。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Linking } from 'react-native';

const ASKED_KEY = 'reunite.reviewAsked';
const WRITE_REVIEW_URL = 'https://apps.apple.com/app/id6782853400?action=write-review';

type StoreReviewModule = {
  isAvailableAsync(): Promise<boolean>;
  requestReview(): Promise<void>;
};

export async function maybeAskForReview(): Promise<void> {
  try {
    // 一生只问一次 —— 安静的产品不纠缠。先落盘再弹窗,防止任何路径下重复打扰。
    if (await AsyncStorage.getItem(ASKED_KEY)) return;
    await AsyncStorage.setItem(ASKED_KEY, '1');

    let StoreReview: StoreReviewModule | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      StoreReview = require('expo-store-review');
    } catch {
      StoreReview = null; // 原生模块不在这个 build 里(OTA 到旧包)→ 走兜底
    }

    if (StoreReview && (await StoreReview.isAvailableAsync().catch(() => false))) {
      await StoreReview.requestReview(); // 是否真的显示由系统决定
      return;
    }

    Alert.alert(
      'A quiet favor',
      'Reunite is made by one person. If this moment meant something to you, a short review helps others find it.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Leave a review', onPress: () => Linking.openURL(WRITE_REVIEW_URL).catch(() => {}) },
      ],
    );
  } catch {
    // 评价邀请永远不允许影响封存主流程 —— 任何错误静默吞掉。
  }
}
