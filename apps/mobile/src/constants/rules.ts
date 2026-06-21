// 产品铁规则。
// 灵魂见 MANIFESTO「封存即消失」—— 要足够久,久到你真的忘了。

/**
 * 黑客松演示模式。
 * true  = 演示:允许选「今天」送达,且封存后自动触发送达 → 几秒内收到邮件。
 * false = 正式:最短封存 15 天。
 * 演示结束后改回 false 即恢复真实规则。
 */
export const DEMO_MODE = false;

/**
 * 封存的最短跨度(天)。送达日期必须 ≥ 今天 + MIN_SEAL_DAYS。
 * 整个 app 只在这里定义这个数字 —— 想调下限,只改这一行。
 * 演示模式下为 0(可选今天)。
 */
export const MIN_SEAL_DAYS = DEMO_MODE ? 0 : 15;
