# Reunite 上架计划（App Store + Google Play）

> 从「Expo Go 演示」→「双平台正式上线、带内购」。
> 名词第一次出现都有大白话解释。🔴=硬卡点（不做就上不了线），🟡=重要但不卡，⭐=最该重视。
> **SHARED** = iOS / Android 共用，只做一次。

---

## 0. 上线前的「保命开关」（先做，便宜）

- [x] **关闭 DEMO_MODE**（已完成 ✅）。`rules.ts` 和 `deliver/index.ts` 两处都改成 `false`，后端已重新部署。
  现在恢复产品核心：最短封存 15 天、信只在送达日才发。
- [ ] 🔴 **账号删除功能（两个商店都强制要求）。** App 有账号（邮箱 OTP 登录）就必须给用户「删除账号」入口。
  - iOS：App 内必须有删除按钮（Apple 5.1.1(v)）。
  - Android：App 内 **+** 一个网页链接也能删（Google 双重要求，网页可挂在 Vercel，如 `…/delete-account`）。
  - 做法：`AccountButton.tsx` 加「删除账号」→ 调一个 Supabase Edge Function（用 service_role 钥匙，在服务器端删 auth 用户 + 他的 letters）。
  - ⚠️ 要明确告知：删账号会**取消所有还没送达的信**，它们永远不会到达。删除前必须弹醒目警告。
- [ ] 🔴 **修 app.json 里的几个坑**（专家在读代码时发现的真 bug）：
  - `ios.icon` 指向 `./assets/expo.icon`（这个文件不存在）→ **会让 iOS 构建失败**。改成真实图标。
  - Android adaptiveIcon 的前景图用了 `reunite-icon.png`，但有个专门的 `android-icon-foreground.png` 没用上 → 确认用对。
  - `experiments.baseUrl: "/app"` 是**网页专用**设置，要确保它不污染原生 App（构建后真机验一下深链接/字体/图片没坏；不行就挪到 `app.config.js` 里只在 web 时生效）。
  - 没设 `ios.bundleIdentifier` / `android.package` → 见下。

---

## 1. 🔴 Day-1 就要启动的「最长的队」（在背后排队，别等）

这几件本身不难，但**审批要等好几天甚至两周**，越早开始越好：

1. 🔴 **Apple 开发者账号**（$99/年）。个人注册审核 24–48 小时。**今天就交。**
2. 🔴 **Google Play 开发者账号**（$25 一次性）。新个人号要**实名认证**（政府证件），要几天。
3. ⭐🔴 **Google 的「14 天闭测」要求。** 新个人开发者号必须先做一个**闭测：至少 12 个测试者、连续 14 天**，才能申请上正式版。
   → **今天就开始拉 ~12 个有 Google 账号的朋友/家人**。这是整个 Android 时间线最长的一根，和别的事并行跑。
   （如果以**公司/组织**身份注册，这条不适用，值得考虑。）
4. 🔴 **Apple Paid Apps 协议 + 税务/银行信息**。不签这个，内购连「可提交」都点不亮，也收不到钱。银行验证有延迟，早做。
5. 🟡 **App Store 小企业计划**（年收入 <$100 万抽成 30%→15%）。账号和 App 记录建好后立刻申请，让第一笔销售就是 15%。

---

## 2. 构建：从 Expo Go 换成「自己的安装包」（SHARED）

> Expo Go 是 Expo 提供的壳，只能加载你的 JS 代码，做演示行；但它装不了你自己的图标、内购、也不能上架。
> 上架要用 **EAS Build**（Expo 的云端打包服务）打出你自己的、用你身份签名的安装包。

- [ ] `npm i -g eas-cli` → `eas login` → `eas init`（在 `apps/mobile/` 里）。
- [ ] 🔴 新建 `eas.json`，三个档：`development`（带原生模块的调试版，**以后日常开发用它替代 Expo Go**）、`preview`（内部测试）、`production`（上架版，`autoIncrement:true` 自动累加构建号）。
- [ ] 🔴 设包名（**一旦发布永久不可改**）：iOS `ios.bundleIdentifier`（如 `app.reunite.ios`），Android `android.package`（如 `com.reunite.app`）。
- [ ] 🔴 图标 1024×1024（无透明、无圆角）；splash 已配好，真机看一眼不被裁。
- [ ] 🔴 **相机/相册权限文案**（照片+视频功能需要，否则崩溃/被拒）。在 `expo-image-picker` 插件里写品牌语气的说明（iOS 的 `NSPhotoLibraryUsageDescription` 等）。
  👉 若**首版只做纯文字**，可以先不要媒体权限，等做付费媒体档再加 —— 权限越少，隐私审核越顺。
- [ ] 构建产物：iOS 出 `.ipa`，Android 出 `.aab`。签名都让 **EAS 托管**（自动管证书/上传密钥，别手搓 keystore）。

---

## 3. 💰 内购：一次封存一次收费（消耗型，不是订阅）（SHARED）

价格阶梯（已进 deck）：免费一封纯文字(1年) · **Letter $2.99**(文字) · **Keepsake $4.99**(文字+照片+短视频，主推) · **Heirloom $9.99**(更丰富媒体)。

- [ ] 🟢 **用 RevenueCat**（一个 SDK 同时搞定 iOS StoreKit 和 Android Play Billing，还帮你做服务器端票据校验）。装在 development 构建里（Expo Go 跑不了）。
  ⚠️ 不要用 `expo-in-app-purchases`（已废弃）。
- [ ] 🔴 在两个商店各建 3 个**消耗型**内购产品（id 永久）：
  - iOS：`reunite.letter.text` / `reunite.keepsake.media` / `reunite.heirloom.media`
  - Android：`reunite_letter` / `reunite_keepsake` / `reunite_heirloom`
- [ ] 🔴 iOS 首次提审时，**3 个内购要和 App v1.0 一起提交**（漏了会白审一轮）。
- [ ] ⭐🔴 **服务器端校验购买，再允许封信**（高风险，碰钱）。流程：用户付钱 → RevenueCat 验票 → 你的 Supabase Edge Function 确认后，才允许写入 `letters`。
  绝不能信客户端说「我付了」。要测：没付却想封信、校验失败、付了但写库失败（不能收了钱却没封成信）。**这段值得找新眼睛对抗式 review。**
- [ ] 免费那封（纯文字/年）由服务器记一次额度，不是客户端开关。

---

## 4. 实体信 upsell（高毛利，走商店外）

> 送达那天，寄一封真实火漆封口的纸质信到家，$29–$39，毛利 ~70%。

- [ ] **必须走网页 + Stripe，不走商店内购**（两家政策都允许实体商品走外部支付）。
- [ ] 合规边界：别在 App 里放个按钮当成「数字购买」去调 Stripe；做成清晰的**实体商品**，在网页/收信流程里买。首版可以先只在网页端卖，App 里不碰。

---

## 5. 隐私 + 商店素材（🔴 不填不能发）

- [ ] 🔴 **隐私政策网页**（两家都要求，挂 Vercel 如 `…/privacy`）。如实写：存邮箱 + 信件内容、**仅静态加密、非端到端**（因为要在送达日读出来发邮件）、用 Resend 发信、无广告。**别声称端到端加密**。
- [ ] iOS「隐私营养标签」/ Android「数据安全表」：邮箱=账号+功能、信件/媒体=功能、**不做广告追踪**（这是卖点）。
- [ ] 截图（已有真实 app 截图，deck 里那套）、Android 还要 1024×500 特征图、内容分级问卷、应用分类、简短/完整描述（保持安静的品牌语气，别用「最棒/#1」）。

---

## 6. 测试 → 提审 → 灰度发布

- [ ] iOS：`eas submit -p ios` → **TestFlight** 沙盒里真机测 3 个内购 + 免费路径 + 服务器校验。
- [ ] Android：`eas submit -p android` → 内部测试 → 闭测（含第 1 节的 14 天要求）→ 正式，**灰度 10–20% 起**观察崩溃率再放量。
- [ ] **软启动**：先开 1–2 个英语市场（或灰度限流），别一上来全球。
- [ ] 给审核员留测试账号 + 备注，**解释 15 天最短封存**，免得他以为封信坏了。

---

## 7. ⭐ 上量前最该验的一件事：收信邮件能进收件箱

整个产品就是「那天信到你邮箱」。进了垃圾箱 = 承诺破产。放量前务必：

- [ ] 确认发信域名 **SPF / DKIM / DMARC** 三条 DNS 记录都齐（你之前域名已验证，重点确认 DMARC）。
- [ ] 给 **Gmail / Outlook / Yahoo / iCloud** 各发一封真实「You, in {year}」收信邮件，逐个看**进收件箱还是垃圾箱**。
- [ ] 真跑一遍 cron：封信 → 等当天 → 邮件进收件箱、带网页揭晓链接 + 底部纯文字保命副本。

---

## 时间线：哪些今天就并行启动
1. Apple 开发者账号（1节·2）+ Google 账号实名（1节·3）+ **Google 14天闭测拉人**（最长，1节·4）—— 三件背后排队。
2. 关 DEMO（✅）+ 账号删除 + 修 app.json 坑（0 节）。
3. RevenueCat + 服务器端校验（3节）—— 碰钱的高风险件，留时间。
4. 收信邮件可达性（7节）—— 产品的命根子。
