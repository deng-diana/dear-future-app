// 跨端提示弹窗。
// 原生用 RN 的 Alert;但 react-native-web 的 Alert.alert 是「空操作」——
// 网页上什么都不显示,错误会被静默吞掉(用户看到的就是"点了没反应")。
// 所以 web 改用浏览器原生 alert:简陋,但看得见 —— 对官网 demo 足够。
import { Alert, Platform } from 'react-native';

export function notify(title: string, message: string): void {
  if (Platform.OS === 'web') {
    // globalThis.alert 在浏览器里一定存在;用可选调用保险(SSR/测试环境无害)。
    (globalThis as { alert?: (msg: string) => void }).alert?.(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message, [{ text: 'OK' }]);
}
