# 隐私表格对照表（Apple App Privacy / Google Data Safety）

> 配合 `web/reveal/privacy/index.html`（线上 `/privacy`）。填商店表格时照这个填，三处口径一致。
> 主旋律：**所有数据都是 "App Functionality"；没有 "Tracking"；不卖。**

## Apple — App Privacy（隐私营养标签）

| 数据类型 | 收集? | 关联身份? | 用于追踪? | Apple "purpose" 选 |
|---|---|---|---|---|
| Email address（Contact Info） | Yes | **Yes** | **No** | App Functionality；Account Management |
| User content — 信件文字（User Content → Other User Content） | Yes | **Yes** | **No** | App Functionality |
| User content — 照片/视频（User Content → Photos or Videos）*仅付费媒体档* | Yes | **Yes** | **No** | App Functionality |
| Purchases / 购买记录 | Yes | **Yes** | **No** | App Functionality |

- App Tracking Transparency：选 **"No, we do not use data to track you"**。无广告 ID、无第三方广告/分析 SDK。

## Google Play — Data Safety

| 数据类型 | 收集? | 共享? | 用途 |
|---|---|---|---|
| Email address（Personal info → Email addresses） | **Yes** | **No** | Account management；App functionality |
| 信件文字（App activity → Other user-generated content） | **Yes** | **No** | App functionality |
| 照片/视频 *仅付费媒体档* | **Yes** | **No** | App functionality |
| 购买记录（Financial info） | **Yes** | **No** | App functionality |

另外在 Google 表格声明：
- **Data encrypted in transit:** Yes
- **Users can request data deletion:** Yes —— App 内删除 + 一个公开网页删除链接（Google 强制要求网页链接）
- 子处理方（Supabase / Resend / Vercel / RevenueCat）是"代你处理"的服务商，按 Google 定义是 **processing 不是 sharing**。

## 发布前要补的 TODO（隐私政策里已用黄标标出）

1. **Effective date** —— 改成真实发布日期
2. **privacy@dearfuture.space** —— 建好这个邮箱并能收信（和之前 unsubscribe@ 一起在 Namecheap 配转发）
3. **网页删除账号 URL** —— 做 Android 时建一个公开删除页（Google 强制）
4. **Supabase 数据区域** —— 确认你 Supabase 项目在哪个区，填进"International transfers"段
5. 公司注册地址 —— 已按 App Store Connect 里的填好（如需更精确再改）
