// 邀请用户评价 —— 业内最佳实践:在情绪最高点(封存完成)请求,且一生只问一次。
//
// 两层实现,同一段代码在新旧包里都正确:
//  ① 原生评分弹窗(expo-store-review):App 内直接点星,体验最好、转化最高。
//     需要带该原生模块的 build(build 17+);系统自动限频(每用户每年最多 3 次)。
//  ② 兜底(build 16 走 OTA 时):温和的 Alert → 跳 App Store 写评论页。
//     直接跳转会突兀,所以先问一句;纯 JS,可随 OTA 下发。
//     (模拟器没有 App Store,跳转会报"address is invalid" —— 真机正常。)
//
// ⚠️ 探测方式必须用 expo 的 requireOptionalNativeModule:模块不在时返回 null,
// 绝不抛错。不能用 try { require('expo-store-review') }:包内部的
// requireNativeModule 在缺原生模块时会抛错,dev 弹红屏,release 有崩溃风险
// (见 memory:Hooks 规则违规→只在 release 崩 的教训 —— JS fatal = SIGABRT)。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { Alert, Linking } from 'react-native';

const ASKED_KEY = 'reunite.reviewAsked';
const WRITE_REVIEW_URL = 'https://apps.apple.com/app/id6782853400?action=write-review';

export async function maybeAskForReview(): Promise<void> {
  try {
    // 一生只问一次 —— 安静的产品不纠缠。先落盘再弹窗,防止任何路径下重复打扰。
    // dev 里跳过这条,方便反复调试弹窗本身。
    if (!__DEV__) {
      if (await AsyncStorage.getItem(ASKED_KEY)) return;
      await AsyncStorage.setItem(ASKED_KEY, '1');
    }

    // 原生模块在这个 build 里吗?不在 → null(不抛错),走兜底。
    const hasNative = requireOptionalNativeModule('ExpoStoreReview') != null;

    if (hasNative) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const StoreReview = require('expo-store-review') as {
        isAvailableAsync(): Promise<boolean>;
        requestReview(): Promise<void>;
      };
      if (await StoreReview.isAvailableAsync().catch(() => false)) {
        await StoreReview.requestReview(); // 是否真的显示由系统决定
        return;
      }
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
