# SCRATCHPAD — 写给未来的自己

> 工作日志,最新在上。
> 产品灵魂见 [MANIFESTO.md](MANIFESTO.md) —— 那份不轻易改;这份记录"我们走到哪了"。

## ▶ 下一步从这里继续

**Resume (2026-06-25 late):** Build 6 was built + tested on device. Since then,
several MORE app-side fixes landed that need a **build 7** (NOT in build 6):
- `84a5bc5` **video compression fix (CRITICAL)** — compression never ran on
  device (New-Arch / TurboModule made `NativeModules.Compressor` null → check
  always false). Even a 36s clip was rejected. Now requires-and-calls the lib
  directly. [[reunite-newarch-compressor-skip]]
- `6ec399e` video "too large" message now shows real MB (self-diagnosing).
- `5d02fde` keyboard-up footer gap tightened + slimmer primary button.
So: **cut build 7** (bundles the above) → full device regression incl. VIDEO
seal → then attach to the "1.0 Prepare for Submission" version, fill the App
Store listing (copy in `docs/app-store-submission.md`), App Privacy + Age
Rating, App Review notes + demo login → submit for review.

**DELIVERY IS NOW LIVE (the last fatal gap — fixed this session).** The `deliver`
Edge Function + Resend always worked, but NOTHING triggered it on a schedule, so
due letters were silently never sent (founder checked inbox → zero). Fixed:
`supabase/sql/2026-06-25-deliver-cron.sql` → pg_cron job `deliver-due-letters`,
daily 07:00 UTC, applied + verified `active=true` (jobid 2). Manual invoke also
proved the function emails real letters to the inbox (not spam).
[[reunite-delivery-cron]]

Other confirmed-live this session: the seal-letter SERVER fix is deployed (photo
paid-seal verified on device → reached "Sealed"). The "You're all set / purchase
successful" blue-OK dialog is **Apple's StoreKit system dialog** (not our code) —
cannot be removed.

Open (low priority): the Supabase `memories` bucket file-size limit is the
Supabase free-plan 50 MB; fine since 5-min videos compress to ~45 MB. Raising it
needs the Pro plan.

**Pre-launch security TODOs (do NOT forget):**
- Remove `ALLOW_SANDBOX_PURCHASES` from Supabase secrets (currently `true` for
  TestFlight testing — leaving it lets anyone seal paid letters for $0 via sandbox).
- Rotate the once-exposed `service_role` key.
- Set up the App Review demo login (Supabase fixed-OTP `review@dearfuture.space`
  + code `123456` via the `recovery_token` hash trick — steps in submission kit)
  and TEST it before submitting.
- App Store listing/support URLs use the live `dear-future-app.vercel.app/...`
  pages; can switch to the custom domain `dearfuture.space` later.
- Set the real "Effective date" on the privacy page.

### 2026-06-25 — First real paid seal on device: bug hunt + build 6

Real-device TestFlight (build 5) testing surfaced 3 issues; all root-caused
(with senior/adversarial subagents) and fixed. tsc clean throughout; the
high-risk money change was adversarially reviewed (caught a bug in the first
fix — see below).

**1. Paid seal failed after a successful purchase (`166b599`, deployed).**
Root cause was SERVER-side, not payment: the app packs multiple photos as a
JSON array string (`photo_url = JSON.stringify(urls)`), but `seal-letter`
validated it with `photo_url.startsWith(memPrefix)` — a JSON array starts with
`["`, so it 400'd BEFORE purchase verification. This path was never exercisable
in the simulator (no real store), so it only surfaced on the first real-device
paid+photos seal. Fix: parse the JSON array, require every element to be a
memories-bucket URL. Also hardened IAP verify against StoreKit 2 transaction-id
drift (match store_transaction_id OR id, recent-purchase fallback).
**Deployed by the founder** (`supabase functions deploy seal-letter`) → verified
working on device (reached the Sealed screen).

**2. Adversarial review caught a double-spend in MY fix (`bc22438`).** The
recency fallback's `lockId = ... || txId` could fall through to the client-
supplied txId when the matched RC entry lacked a stable id (the very StoreKit 2
case the fallback targets) → forged txIds could seal unlimited paid letters in a
10-min window; and `find()` bound the lock to array order. Fix: filter the
sandbox gate up front; prefer exact match; recency only as a guarded fallback to
the newest entry that HAS a server-side stable id; lock derives SOLELY from the
matched transaction's stable id (never client input), reject if none. Re-review:
SHIP. (Compound-loop win: a fresh-eye reviewer caught what tsc + my own eyes
missed on the money path.)

**3. Video rejected at 50 MB before compression (`ca1f0ce`).** `pickVideo`
checked the RAW picked file against the 50 MB Supabase free-plan ceiling BEFORE
`compressVideoIfNeeded` ran, so a normal 5-min phone video (200-400 MB raw) was
rejected even though it compresses to ~45 MB. Dropped the pre-compression size
guard (kept the 5-min duration guard); the post-compression guard in
`uploadMedia` is the real ceiling. Compression confirmed present in EAS builds
(react-native-compressor is a native dep; only Expo Go lacks it).

**Also (`711e2ff`, `3e7da2d`):** keyboard-safe footer on home-indicator iPhones
(KeyboardAvoidingView `keyboardVerticalOffset` = top inset; footer pads past the
home indicator); `doSeal` now reads the real server error from `error.context`
instead of the generic "non-2xx"; Sealed heading "Sealed" → "Your letter is
sealed" for clearer success feedback.

### 2026-06-24 — Launch sprint: device-crash fixes, seal flow, free pricing, IAP, polish

EAS pipeline + 5 TestFlight builds; two real device-only crashes found via crash
logs + expert review; the seal flow un-stuck; the pricing model flipped to
"text free forever, media paid"; IAP fully wired end-to-end; a big pile of UX
polish. tsc clean throughout; high-risk server change fresh-eyes reviewed (PASS).

**EAS / TestFlight pipeline:**
- `eas init` → projectId `b7bc0908-…`, owner `dianadeng`, slug `reunite`. `eas.json`
  production profile (autoIncrement, `environment: production`); 3 `EXPO_PUBLIC_*`
  env vars pushed to EAS. Submit profile **pinned** `ascAppId: 6782853400` +
  `appleTeamId: N3985C22VN` (Shanghai Youzhuoqu) to dodge flaky ASC app-lookup
  500s (commit `783146b`). Builds 1–3 on TestFlight; 4 superseded; 5 submitting.

**Two device-only crashes (each simulator-green, release-red):**
- Build 1 launch crash = dyld "Symbol not found" (ExpoFileSystem ↔ ExpoModulesCore)
  from Expo patch-version drift → `npx expo install --fix` (`804aac1` era). [memory]
- Build 3 "tap Start" crash = Rules-of-Hooks violation (`useRef`/`useEffect` below
  three early returns) → hoisted above all returns (`9e98a78`). [memory]

**Seal flow stuck bug (`7e0a3ff`):** date sheet + price sheet were two separate
RN `<Modal>`s; date→seal dismissed one while presenting the other → iOS dumped to
the writing screen and froze taps. Merged into ONE BottomSheet that swaps content
by `step`. [memory]

**Pricing model change (founder decision): text always FREE + unlimited; media paid.**
- Client `tiers.ts`: no media → always free (`a49f12c`). Media tiers lowered:
  Photos & Short Video $4.99→**$2.99**, Rich Media (was "Photos & Long Video")
  $9.99→**$5.99**.
- Server `seal-letter` (`0c66a59`): removed the once-only-free check + 365-day cap →
  free is now unlimited, any horizon (1d..~25y). New migration
  `2026-06-24-unlimited-free-seals.sql` **drops** the `letters_one_free_per_owner`
  unique index. `MIN_SEAL_DAYS` 15→**1** on BOTH client + server (earliest = tomorrow).
  **Deployed** (ran the SQL migration in dashboard, then `supabase functions deploy
  seal-letter`). Fresh-eyes review = PASS (no free-media bypass; paid path's
  RevenueCat verify + anti-replay intact). [memory: two-rn-modals, rules-of-hooks,
  version-mismatch]

**IAP fully configured + verified:**
- App Store Connect: 3 consumables all "Ready to Submit" — `reunite.seal.photos`
  $2.99 (display "Photos & Short Video"), `reunite.seal.video` $5.99 ("Rich Media"),
  `reunite.seal.words` free/unused (don't attach to the version). Review screenshot
  uploaded (saved at `~/Desktop/reunite-iap-screenshot.png`).
- RevenueCat: "default" Offering packages `words`/`photos`/`video` map to the right
  products (verified); App Store Connect API key "Valid credentials". Prices auto-sync
  from ASC (RevenueCat doesn't store prices).
- Payment→verify→seal confirmed: app `configurePurchases()` + `Purchases.logIn(uid)`;
  server `seal-letter` verifies the transaction via RevenueCat `/v1/subscribers/{uid}`
  + `used_transactions` anti-replay, rejects sandbox unless `ALLOW_SANDBOX`.
  TestFlight purchases are **sandbox = no real money**.

**UX polish (many commits):** 3-tier pricing ladder; copy "up to N photos" /
"<30s video" / "<5min video"; border-only selected tier (no fill); scrollable
dateline + keyboard-safe footer; photo thumbnails pinned in footer; avatar moved
into the scroll; calendar 7-column fix (`100/7%` float-wrap) + one-line heading
"When should it come home?" + new `colors.textDisabled` token for lighter
unselectable dates; account menu (Delete above Sign out, sign-out in body color +
Ionicons icons via new `@expo/vector-icons`); video 5-min fix (drop `allowsEditing`
+ >300s guard).

**Web + docs:** deployed privacy + new `/support` page (live on
`dear-future-app.vercel.app`). `docs/app-store-submission.md` = full submission kit
(listing copy, review notes, IAP, checklist).

### 2026-06-23 — Seal sheet redesign + video fix (tsc clean)

**Landed (all tsc clean, no tests changed):**

**Task 1 — 3-box pricing ladder in SealSheet:**
- Added `LADDER` constant (outside component) with `words / photos / video` keys.
- Replaced the old single-row `sealSheetTierRow` JSX + styles with a horizontal `sealSheetLadder` of three static `View` boxes (no `onPress`).
- Active box = `tierResult.tier ?? 'words'`; free capsule → Words box is active, price shows "Free".
- Tokens used: inactive border = `colors.border` (`palette.borderMid` `#C9B097`); inactive muted lines = `colors.textMutedSoft` (`palette.mutedSoft` `#6B5A4B`).
- Added import of `TIERS` from `purchases.ts` (was missing).

**Task 2 — Remove "keepsake" reason line for paid tiers:**
- `sealSheetReason` now renders only when `tierResult.isFree` (shows "Your first capsule is on us.").
- For paid tiers the 3 boxes do the explaining. Old `sealSheetTierRow / sealSheetTierName / sealSheetPrice` styles deleted.

**Task 3 — Words-only Alert explains the reason:**
- Alert title: "Seal with words only?"
- Body dynamically names the media (e.g. "3 photos and a video"), explains the Words tier is text-only so they can't travel, reassures nothing is deleted, states "Only your words will be sealed."
- Buttons: "Keep writing" (cancel) / "Seal words only" (confirm, no destructive style).

**Task 4 — Video 5-minute fix (real bug):**
- Removed `allowsEditing: true` from `pickVideo` in `media.ts`. On iOS, `allowsEditing` activates the system trim UI which hard-caps library selection at ~30 s, regardless of `videoMaxDuration` (which only limits recording). Verified against Expo SDK 56 docs.
- Added explicit post-pick guard: if `durationSec > 300`, shows "This video is longer than 5 minutes. Please choose a shorter clip." and returns null. A 45 s or 3-min video now flows through and lands in the correct tier (`photos` or `video`).

**Token names (confirmed real names):**
- Inactive border: `colors.border` (= `palette.borderMid` = `#C9B097`)
- Inactive muted line: `colors.textMutedSoft` (= `palette.mutedSoft` = `#6B5A4B`)

**Files changed:**
- `apps/mobile/src/app/index.tsx`
- `apps/mobile/src/lib/media.ts`

---

### 2026-06-23 — 设计系统整理完成,即将进 EAS

**今天落地(都已提交、tsc 绿):**
- `39a4853` 揭晓页加环境配乐(点击播放/暂停,修了 iOS 忽略 audio.volume 导致暂停失灵的坑)。⚠️ 音乐文件 `web/reveal/assets/music.mp3` 已放,但**揭晓页还没部署上线**,下次部署/做内购上线那批时一起上。
- `8182316` 颜色+字体 → 语义 token:新增 `apps/mobile/src/theme/`(colors/typography/index)。82 处硬编码 hex + 内联字体串收进 token,**改名不改色**(27 个色值一个不少、逐处核对)。文末有 BRAND.md 漂移说明(app 实际主色是赭土 `#B26B24`,不是文档的波尔多红 `#7A1E1E`)待日后定夺。
- `4e0525b` 抽出共享 `<Button>`(solid/link 两变体,disabled/loading 自动防重复点)。迁移 10 处手写按钮。**刻意没抽** Input/Modal/Card(对一屏 app 过度工程)。
- `a8ee90a` web 统一设计 token:新增 `web/reveal/assets/tokens.css`,三页共用;隐私页从波尔多红→对齐 app 赭土色;修了照片扇形(380→430px 断点+窄屏缩图)和隐私表格两个手机溢出 bug;reveal 字号改 clamp。字体保持 Courier Prime。
- `be13083` a11y 全量 + 对比度达 WCAG AA(用户选全 AA):读屏标签/自动填充/"已封存"播报/装饰图隐藏/触控区≥44pt/弹层 modal/减弱动效(SealCeremony onDone 有 guard 只触发一次);新增 brandButton#9D5E1F / brandText=brandDark / brandSelected 三个 token,muted 系全部加深到 ≥4.5:1。
  - ⚠️ **TestFlight 眼检**:按钮底色略深、Dateline/已封存提示文字明显加深、浅灰辅助字变深 —— 都是对比度达标的预期变化。
  - 真机才能测的(留到 TestFlight):VoiceOver 滑动顺序、封存播报、减弱动效、BottomSheet 焦点、一次性验证码自动填充、最大字号不裁切。

**决策记录(为什么没全做那张"九层图"):** 性能优化(Web Vitals/code-splitting)是**网页**概念,对 RN 原生 app 不适用;工程化全套测试+CI 会拖慢上线 → 都推迟到上线后。只做了真有债的 Design System + a11y。

**▶ 下一步:Phase 3 — EAS 打包 → TestFlight。** 第一步 `eas login`(Dan 已有 Expo 账号)。然后我做 `eas init` + 配云端公开变量 + `eas build --platform ios` → `eas submit`。

---

### 服务器端购买验证(2026-06-22)— 待编排器执行

**已构建(tsc 零错误,未部署,未运行 SQL):**
- `supabase/functions/seal-letter/index.ts` — 新 Edge Function(Deno)
- `supabase/sql/2026-06-22-seal-server-side.sql` — 第一个迁移(加列 + 新表)
- `supabase/sql/2026-06-22-lock-letters-insert.sql` — 第二个迁移(删客户端 INSERT 策略,最后运行)
- `apps/mobile/src/lib/purchases.ts` — 扩展 PurchaseResult.transactionId + setPurchasesUser/clearPurchasesUser
- `apps/mobile/src/app/_layout.tsx` — SIGNED_IN/SIGNED_OUT 触发 logIn/logOut
- `apps/mobile/src/app/index.tsx` — doSeal 改用 seal-letter Edge Function

**进度:**
- [x] 设 `REVENUECAT_SECRET_KEY` + `ALLOW_SANDBOX_PURCHASES=true`(测试期)
- [x] 运行 `2026-06-22-seal-server-side.sql`(列+表+免费唯一索引,已 Success)
- [x] 部署 `seal-letter` 函数
- [x] 对抗式安全审查 + 修复(拒沙盒 / 免费竞态DB约束 / 25年上限)

**剩余(内购上线收尾,休息后做):**
1. ⬜ **EAS 打包** → 装真机/TestFlight
2. ⬜ **沙盒测试**:免费封一次 + 付费封一次,各走通(确认 seal-letter 路径工作)
3. ⬜ **最后跑** `2026-06-22-lock-letters-insert.sql`(锁死客户端直插=校验真正生效;测试通过才跑)
4. ⬜ **上线前**:移除 `ALLOW_SANDBOX_PURCHASES`、升 Supabase Pro(永不暂停+大存储)
5. ⬜ App Store 那两个媒体商品显示名改 Photos & Short Video / Photos & Long Video
6. ⬜ DMARC 加 rua、配 `unsubscribe@`/`privacy@` 转发、账号删除网页 URL(Android)
7. ⬜ **DMARC 收严收尾(约 2026-07-06,即观察 ~2 周后)**:DMARC 记录已是 `p=none`(收严第一步已完成 ✅,2026-06-22 dig 确认 `p=none; rua=...; fo=1; adkim=r; aspf=r`)。Namecheap 一键邮件转发因发信走 Resend 显示 "using other email service",**这是预期、无害,先放着**。最后一步:把 `p=none → p=quarantine`(也是以后 BIMI logo 头像的硬前提)。`unsubscribe@`/`privacy@` 真实转发到上线前再配(届时改 Advanced DNS → Mail Settings,**小心别删 Resend 的 mail. 子域发信记录**)。

**🔐 进行中(用户最高优先):端到端/静态加密** —— 信件正文当前在 DB 是明文,要加密。方向待定(见对话:静态加密 A / 时间锁 B / 真E2EE C)。定向后:详细计划→资深 review→/loop。

---

### 🌙 明天从这里接(RevenueCat 拿 key)
**目标:拿到 Apple 的 `appl_` 公钥发给 Claude。**
1. 登录 app.revenuecat.com → 项目「Create an app called Reunite」
2. 左下角**齿轮(Project settings)→ Apps → + New → App Store**
3. 填 App name `Reunite` + Bundle ID `com.stillkindailab.reunite` → 保存
4. 回 **API Keys** → SDK keys 里出现 Apple 行 → **Show key** → 复制那把 `appl_` 开头的发我
- 拿到后:开 /loop 把内购接进「封信付费」流程 + **服务器端校验**(碰钱,走安全审查)
- 顺手:确认 RevenueCat 邮箱(确认邮件里的链接);项目名可改成干净的 `Reunite`
- ⚠️ 注意:RevenueCat 默认推荐的是**订阅** —— 我们不用;Reunite 是**消耗品**($2.99/$4.99/$9.99 一次封信付一次)

### ✅ 今天完成(2026-06-21 · App Store 上架推进)
- **deck 修复+精简+商业模式页**:`/deck` 图片 404 修好(相对→`/deck/assets/`);全篇文案 UX 精简去煽情;新增价格阶梯 + 实体信 upsell 页。
- **关闭 DEMO_MODE**(rules.ts + deliver/index.ts → false),deliver 已重新部署 → 恢复生产逻辑。
- **账号删除功能**(双商店必需):delete-account Edge Function(JWT 取 uid 防 IDOR + 405 + service_role 删信删号)+ AccountButton 双确认 + 重入保护;过对抗式安全审查(核心安全);已部署。
- **收信可达性**:DNS(SPF/DKIM/DMARC)dig 确认健康;deliver 加 reply_to + List-Unsubscribe + 落款,已部署。待你做:DMARC 加 rua、配 `unsubscribe@dearfuture.space` 转发。
- **上架配置**:bundleId/package = `com.stillkindailab.reunite`;app.json 配齐图片/相机/麦克风权限;iOS 图标回品牌图。
- **RevenueCat 脚手架**:装好 + `src/lib/purchases.ts`(web/无钥匙安全空转,未接封存流程)。
- **Apple Business 全部 Active**(Diana 当面操作,逐栏指导):Paid Apps 协议、Bank of China 对公(收 USD 结 CNY)、两税表(Certificate of Foreign Status + W-8BEN-E)、EU DSA trader 声明(修了欧盟下不了的坑,Thankly 也会恢复)。账号是**公司**(上海有拙趣文化创意)→ 税表 W-8BEN-E;Google 14天闭测对组织号不适用。
- 完整上架清单见 [LAUNCH-PLAN.md](LAUNCH-PLAN.md)。

### ☀️ 早安 — 昨夜自动完成的(/loop,2026-06-21 02:xx)
**全部已提交、tsc 全绿、工作区干净。** 关键成果:
- 📸 **多媒体升级**:最多 **4 张照片(多选+缩略图)** + 1 段≤30s 视频;写信→**Finish**→**暗色遮罩弹层选日期**→Seal 两步渐进式流程。
- 🎨 **新品牌全量落地**(app + deck + 看信页):真实 **logo(火漆+金罗盘星)**、赭土色系、**全站 Courier Prime 字体**、`'Dear future me,'` 改为可编辑同号首行。你的校正色已应用:主题/按钮+顶部时间地点 `#B26B24`、写信内容 `#67350F`、首页纯色底 `#FAE6C9`、按钮直角、页边距加大。
- 🛡️ **资深 fresh-eyes 代码 review 通过**:iOS 端**零必修 bug**(无 XSS、deliver 邮件不碰 photo_url、无重复封存、JSON photo_url 解析健壮)。(codex CLI 在机但 `--version` 无输出,改用对抗式 subagent 把关,效果等同——它早先就抓出过真实 XSS。)
- 🌐 **Plan-A 网页版 demo 已就绪(未上线,等你定稿视觉)**:`web.output='single'`(SPA)修好 SSG 的 `window` 崩溃;网页版优雅降级(日期用原生 `<input type=date>`、上传用 `fetch().blob()`)。`npx expo export -p web` **构建成功**。

### 🌅 你醒来要做(deadline 11:00):
1. **视觉微调**(你说的)——改完任意颜色/间距后,模拟器会热更新。
2. **上线看信页**(含新品牌):`cd ~/Desktop/dear-future-app && npx vercel --prod --yes`(部署 `web/reveal`)。
3. **Live Demo Link(Plan A app 网页版)**:`cd ~/Desktop/dear-future-app/apps/mobile && npx expo export -p web && npx vercel deploy dist --prod` → 拿到的 URL 就是提交表单的 Live Demo Link。(网页版可文字+图片+OTP 登录全流程跑通;photo 走 blob 上传、date 走原生选择器。)
4. **录 demo 视频** + **提交 Encode 表单**(4 个链接:Live Demo / Code / Deck / Video)。
5. 赛后:`DEMO_MODE` 改回 `false`、轮换 service_role key、孤儿媒体清理。

**🏁 黑客松提交:2026-06-21 上午 11:00 前。** 产品功能已全部完成,**重点是把现场 demo 演漂亮**(演示脚本见本文件 2026-06-20 下半段)。

**📸 多媒体封存已落地(2026-06-21 凌晨)**:信件可附 1 张照片 + 1 段≤30s 短视频,封存一起送达,看信页以 Polaroid 呈现(`249a428`)。fresh-eyes 资深 review 抓到并修掉 3 个必修项(`82a4a57`):看信页 XSS(引号转义 + 只渲染本桶链接)、上传失败静默丢图(改成 Alert 提示不封存)、大视频 OOM(图≤12MB/视频≤25MB 上限)。**未上线:看信页(含 Polaroid + XSS 修复)还没部署到 Vercel。** 命令:`cd ~/Desktop/dear-future-app && npx vercel --prod --yes`。
- ⬜ **测多媒体端到端**:模拟器选图/选视频 → 封存 → 邮箱 → 看信页 Polaroid 显示。
- ⚠️ **需你确认**:Supabase Storage 里 `memories` 桶**存在且为 Public**;**不要**给它加任何 "select/list" 策略(公开桶靠 CDN 直链取文件,不需要 select 策略;加了反而让所有人能列举别人的照片)。
- 赛后 backlog(review 提出):给 `photo_url/video_url` 加 DB check 约束只允许本桶域名、孤儿文件清理、`randomFolder` 换 crypto 随机、私有桶+签名链接。

**提交表单需 4 个必填链接 + 待办:**
- ⬜ **Live Demo Link → 方案 A:把 Expo app 导出网页版部署 Vercel**(RN for Web;日期选择器加 `Platform.OS==='web'` 兼容;看信页挪到 `/read`,主页放 app)。兜底:先填看信页 URL。
- ⬜ Link to Code → 先 `git push` 到 GitHub(本地领先 origin 23 文件)。
- ⬜ Link to Presentation → 做 deck。
- ⬜ Link to Demo Video → 录演示视频。
- 💡 **多媒体封存(朋友反馈:纯文字不够 impressive)**:在信里加**图片 +(可选)短视频**一起封存、到期送达。**符合 manifesto 第二戒(真实高于体面)**。评估:**图片=中等可行、冲击力高**;**视频=高难高险(大文件上传/播放/编码),建议缓到赛后或仅作 roadmap**。截止前优先级低于上面 4 个必交项。

**演示要点**:`DEMO_MODE = true`(`src/constants/rules.ts`)—— 封信后几秒邮箱就收到(允许选今天 + 封存后自动调 deliver)。**演示结束后改回 `false` 恢复 15 天规则。** 演示前务必:① 模拟器里**先登录好**(免现场等 OTP)② Gmail 开在浏览器备好 ③ 若卡白屏,`xcrun simctl terminate booted host.exp.Exponent` 强杀重开。

**赛后再做(已记 to-do,黑客松不碰)**:
- 🛡️ 生产硬化:Turnstile 防刷(signInWithOtp)、GDPR 删除/导出、deliver/RPC 加鉴权(现 verify_jwt 关)。
- 🔒 安全:**轮换 service_role 钥匙**(2026-06-20 终端截图露过)。
- 🎨 资产:真实棉纸纹理(需图片素材)、App 图标 + 启动屏(火漆+北极星)、看信页配乐/拆封节奏。
- 📱 平台:Android 未验证、真机 Development Build。
- 💰 商业:"封存收一次费"的收款。
- 演示后把 `DEMO_MODE` 改回 `false`。

提醒:验证码 8 位;邮件发件域名仍是 mail.dearfuture.space(旧域名,可日后换 Reunite 域名)。

---

## 2026-06-20(下半)— 品牌 + 视觉 + 自动化 + 演示模式(黑客松冲刺)

- **品牌 Reunite**:见上半段。
- **视觉动效(均 watchr 真机验证)**:🎬 封存仪式动效 `SealCeremony`(火漆 spring 盖章→上飘淡出"交给时间"→落 Sealed 屏);🏙️ 可编辑城市 `Dateline`(点 London 改、AsyncStorage 记住、点线下划线暗示、零权限);📄 纸张质感 `PaperBackground`(象牙底+颗粒+内晕+卷角近似)。
- **送达自动化**:`pg_cron` + `pg_net` 建定时任务 `deliver-letters-daily`(每天 UTC 09:00 调 deliver,`active=true`)。
- **演示模式**:`DEMO_MODE` 开关;封存即可立刻送达(实测 app 封信 → ~12s 进收件箱)。
- **大坑教训**:Expo Go 进程会**卡死、不再重载**(exp:// 重开/改代码都没用),界面空白且无报错 —— 必须 `xcrun simctl terminate booted host.exp.Exponent` 强杀重开才真重载。曾误以为是布局 bug,白查很久。

---

## 2026-06-20 — 核心闭环打通:送达 + 看信页(写→封→送→看 全通)

**这天把后半截"送→看"整个做完并端到端验证。**

- **品牌更名 Reunite**:存 `BRAND.md`(创始人写);新建 `README.md` + 根 `CLAUDE.md`;MANIFESTO/MVP-V1/PRD 标题加 Reunite(中文原名"写给未来的自己"保留)。
- **视觉**:写信屏升级 Cormorant Garamond 题头 + 象牙白 #F4EEE4 + 呼吸层 + 金色光标;邮戳 IBM Plex Mono;正文 Courier Prime;Seal 按钮波尔多红 #7A1E1E + 古金 ✦。头像安全区 bug 修复(改用正常布局流,经 watchr UI 树验证)。
- **数据库**:`letters` 加 `reveal_token uuid default gen_random_uuid()`;建 `reveal_letter(token)` RPC(security definer + grant anon,只返回已送达的信)。
- **送达**:新建 `deliver` Edge Function(service_role 跑;查到期未送的信→admin 查邮箱→Resend 发信→回填 delivered_at 防重发)。Resend secret 存 Supabase。**实测:邮件进收件箱(IMPORTANT,非垃圾箱),幂等不重发。**
- **看信页**:`web/reveal/index.html`(读 token→调 RPC→缓缓展开)。**踩坑:Supabase Storage 把 HTML 一律当 text/plain,托管不了网页** → 改部署 **Vercel**(`vercel.json` 把 web/reveal 当静态站;`https://dear-future-app.vercel.app`,text/html 正确)。deliver 邮件链接改指向它。
- **网关坑**:Supabase Edge Function 即使 verify_jwt 关,网关仍要 Authorization 头 → 浏览器没法直接开函数,所以看信页必须放 Vercel。
- **端到端验证**(watchr + Gmail MCP):造到期信→触发 deliver→新邮件链接=Vercel→打开渲染出正确那封信。✅

---

## 2026-06-19 — 黑客松筹备:PRD + 邮箱 OTP 登录闭环

- **PRD.md**:写了 2 天黑客松版 PRD —— 范围(做/不做/演示假装)、逐屏英文文案、5 戒验收、90 秒演示脚本、两天工时排期、风险兜底。核心策略:演示时把送达设"2 分钟后",现场演完整个魔法闭环。
- **记住登录**:`supabase.ts` 加 AsyncStorage + persistSession/autoRefreshToken/detectSessionInUrl:false,关 app 再开还记得登录。
- **登录界面**:新建 `src/components/SignIn.tsx`(英文文案)—— 两步:输邮箱 `signInWithOtp` → 输码 `verifyOtp(type:'email')`。
- **接进封存**:`index.tsx` 加 session 状态 + `onAuthStateChange` 订阅;按封存时没登录→弹 SignIn,验证通过→用真实邮箱 `doSeal`;去掉写死的 `test@dearfuture.app`。
- **踩坑**:验证码是 **8 位**(原 app maxLength 写死 6,只能输前 6 位→残缺码→invalid);改成 maxLength 10、文案去掉"6-digit"、Verify 够 6 位即可点。旧码会过期,要用最新邮件的完整码。
- **验证**:tsc 0 错误;模拟器实测完整跑通,落到"🕯️ 信已封存"屏。

---

## 2026-06-12 — 动手开工:跑起来 + 写信屏第 1 关

**形式**:learning-by-doing,Claude 当导师带做。环境 = iOS 模拟器(iPhone 16e,Expo Go)。

- **第 0 关**:`npm install` + `npx expo start --ios`,app 首次在模拟器跑起来。教了 Metro(打包/热重载后厨)、dev server 在哪/怎么自己起(终端 `npx expo start` 按 `i`)。
- **产品决策**:封存下限 **30 天 → 15 天**(创始人定;理由:特殊情况 30 天太长。仍远大于"提醒类",给特殊情况留空间)。`MVP-V1.md` 4 处已改;MANIFESTO 不动(它不绑死天数)。
- **第 1 关**(写信屏加送达日期):
  - 新建 `src/constants/rules.ts` → `MIN_SEAL_DAYS = 15`(单一事实来源)。
  - `src/app/index.tsx` 用 `@expo/ui/community/datetime-picker` 的 `DateTimePicker`,`minimumDate = 今天+15` 从 UI 层拦死(<15 天的日子变灰不可选);`canSeal = 有字 && 日期达标`;加 `KeyboardAvoidingView`。
  - 验证:截图确认默认 Jun 27、日历 1–26 灰、打字后按钮变黑。`@expo/ui` 原生组件在 Expo Go 能跑(本来担心要 dev build,实测不用)。
- **真机问题**:用户手机 Expo Go 只到 SDK 54(我们用 56),多半是 iOS 版本旧。结论:现在用模拟器,真机留到上线前做 Development Build。
- **已知小瑕疵**:中文日期胶囊仍显示英文(iOS compact 跟系统地区走,`locale` 不完全管用),纯视觉,暂不追。
- **上 git**(commit `1cf629d`):根目录建成 monorepo(删了 apps/mobile 的脚手架 .git),删多标签脚手架残骸,推到私有仓 **github.com/deng-diana/dear-future-app**(账号 deng-diana)。提交前过了资深 RN reviewer:结论"可提交",并修了它指出的"跨午夜 15 天缩成 14 天"off-by-one(earliest 改为每渲染按当天 00:00 重算)+ 无障碍属性。
- **剩余脚手架图片**(react-logo / tabIcons/explore / tutorial-web 等)未删,纯图片不影响编译,以后顺手清。
- **/code-review(high effort,7 角度 finder)第一轮**:核心 15 天下限在 iOS 上确认拦死,无崩溃级 bug。已修(iOS 验证):送达日 onValueChange 归零 startOfDay(#3)、`(15 天后)` 改插值 MIN_SEAL_DAYS(#4)、封存抽 handleSeal 单点捕获 effectiveDate 为后端铺路(#6)、夹取 `>`→`>=`(#7)、earliest 用 useMemo 按当天缓存(#8)、formatDate 改 toLocaleDateString('zh-CN')(#9)。
  - **Android 未验证**(本机无 emulator):已按文档加 `presentation="inline"`(防 Android 挂载即弹模态)、KAV Android behavior 改 'height';但 Android 上 compact 内联胶囊不存在、布局需专门适配 —— **记入"Android 适配"待办,装 emulator 后再验证**。
  - **故意缓修**:#5 iOS 软键盘升起时 SafeAreaView 底部 inset 与 KAV padding 叠加约 34px 间隙 —— 纯视觉、需"键盘感知 inset"才算干净修,且模拟器是硬件键盘模式看不到,留作后期 polish(iOS 行为本次未动,无回归)。

## 2026-06-12 — 第 3 关·auth 方案(经 staff 级 subagent review,长远 best practice)

**验证方式**:6 位邮箱 OTP 验证码(非魔法链接)—— 原生 app 更稳。✅ reviewer 认可。

**reviewer 升级的 4 点(必改/须考虑):**
1. **信的主人用 `auth.uid()`(账号ID),不是 owner_email 字符串。** 邮箱会变/会废(正是 manifesto line 63 担心的死信箱问题);主人身份要稳定,**送达邮箱在"寄出那一刻"再从账号查**(可更新/可重新确认)。→ 改表:`owner_id uuid default auth.uid()`,客户端不传、由服务端定;RLS `with check (owner_id = auth.uid())`。载灵魂,不是 nicety。
2. **auth 发信用 Send Email Hook 调 Resend API,不用 custom SMTP。** auth 和到期发信共用一个 provider/域名/DKIM/信誉面板;SMTP 会变成第二条代码路径+第二个信誉源。
3. **provider:现在 Resend(快),代码包一层 `sendEmail()` 模块,长期落到 Amazon SES**(便宜、AWS 级耐久、自己持有 DKIM 域名身份、与 Paris 区一致)。真正要长存的是"你自己拥有的认证域名",provider 可换。
4. **不能拖到上线前的:** ① 域名(邮件信誉要数周养成,reviewer 说这是唯一真陷阱——test mode 只能让你推迟"写代码",推迟不了"养信誉")② signInWithOtp 上 Turnstile 防刷(被刷→退信→毁域名信誉)③ GDPR 删除/导出 Edge Function(EU 用户存信件,near roadmap)。

**fine as-is**:supabase-js 会话配置(AsyncStorage+persistSession+autoRefresh+detectSessionInUrl:false+AppState 起停)、无 select/update/delete 的 RLS。

**reviewer 建议顺序**:买域名 → Resend/SES 包一层 + Send Email Hook → owner=uid+服务端定 email → Turnstile → GDPR。
**实操折中**:现在可用 Resend test mode(只发到本人邮箱)先把 auth 建+测起来,但域名别拖到上线前。

## 2026-06-12 — 第 3 关:接通 Supabase 后端

- 建 Supabase 项目 `dear-future-app`(组织 BuilderDane,区域 eu-west-3 / Paris,owner dengdan01@gmail.com)。
- SQL Editor 建 `letters` 表(id uuid / owner_email / body / deliver_on date / sealed_at / delivered_at);打开 RLS,只建一条 **insert** 策略(to anon, authenticated, with check true)—— **客户端只能写、永远读不到**,与第一戒"app 从不给你看信"同构。
- app 接入:`npx expo install @supabase/supabase-js react-native-url-polyfill`;`.env`(gitignored)放 EXPO_PUBLIC_SUPABASE_URL + anon key;新建 `src/lib/supabase.ts`(persistSession:false,暂不登录);`handleSeal` 改为 `supabase.from('letters').insert(...)`,deliver_on 用本地 `toISODate` 避免时区偏一天;owner_email 暂写死占位。
- 验证:用 anon key curl POST /rest/v1/letters → **HTTP 201**,Table Editor 里看到该行。后端链路(前端→钥匙→RLS→DB)打通。
- 教学:解释了 anon(anonymous 匿名)public key = app 的"门卡",公开安全因真正门卫是 RLS;OTP=One-Time Password。

## 2026-06-09 — 第三次:设计两个仪式 + 重逢的读信方式

- **封存仪式**:火漆封印 → 放进时光宝盒 → 宝盒连信一起消失。情绪是"放手交给时间",不是归档。宝盒是动词不是名词 —— 绝不能变成以后能打开的地方(否则就是列表换皮)。
- **重逢的读信方式**(关键决策):
  - **看信页(网页)= 主舞台**:拆封动效、字体、配乐、将来的音视频都在这儿。craftsmanship 长在网页里,长不进邮件。
  - **邮件 = 信使**:顶部邀请 +「拆封」链接(主路径);底部夹一份纯文字全文作"保命副本"。
  - 发件人显示名「20XX 年的你」+ 认证域名(保送达)+ Reply-To=用户自己。**不能把 From 写成用户邮箱地址**(伪造发件人 → 进垃圾箱 → 送不到 = 最大背叛)。
- **第三戒落地为一句底线**:"绝不做唯一的那根线" —— 不承诺信永生,只承诺留存不只依赖我们。文字躺邮件正文;将来音视频用附件/推用户自己的云;看信页最美但允许它将来消失,绝不能是唯一副本。
- app 由此更纯:**在 app 里「封」,在世界里「拆」;app 从不给你看任何一封信。**

## 2026-06-09 — 第二次:钉死 V1 范围

确认进 V1 的三件事:① 封存即消失、绝不做列表 ② 到期发邮件 = 送达 + 放生 ③ 最短封存 30 天。
完整定义见 [MVP-V1.md](MVP-V1.md)。要点:
- 整个 app 几乎只有一屏:写信。封存后回到空白写信屏,别无他物。
- 「登录」缩成「封存时验证邮箱」(OTP / 魔法链接,无密码);邮箱既是身份,也是放生地址。先写、封存时才要邮箱,不在门口设登录墙。
- 送达 = 每天跑一次定时任务,查"今天到期"→ 发邮件(不是定 10 年的闹钟)。
- 隐私:信在 DB 静态加密;但到期要靠我们发邮件,故非 E2E,V1 诚实承认。
- 砍到 V2:多媒体、寄给别人、列表 / 红点、重录 / 反悔。

## 2026-06-09 — 第一次对话:用苏格拉底式提问,烧出产品的灵魂

**形式**:用户请我扮演苏格拉底提问,目标是做"小而美、经得起时间考验"的产品。

**烧掉了(砍掉的):**
- "寄给别人" —— V1 砍掉,只写给自己。回避了关系会变、邮箱会废、能否撤回等一堆难题。
- "定时邮件 / 带提醒的备忘录" —— 这不是我们。魔法在"封住 + 遗忘",不在"送达"。

**留下了(灵魂,详见 MANIFESTO):**
- 封存即消失:封好就从眼前消失,直到那天回来。做"让人不打开"的 app。
- 真实高于体面:多媒体承载"拦不住的真实",不止于文字。
- 活得比公司久:app 负责"封存" + 到期"放生"到用户自己的地盘。
- 商业模式:为"封存"这一神圣时刻收一次费(预付存储),不为注意力收费。类比女儿红。
- 小而美、非印钞机 —— 这是目标本身,不是退而求其次。

**关键转折**:用户一度想放弃("没有商业价值")。澄清后发现是"换了尺子"—— 用印钞机的尺去量小而美的东西。而"为神圣时刻付费"的商业模式,反过来加固了哲学,而非杀死它。

**创始人承诺**:愿意用接下来好几年的人生,陪着它。

**悬而未决**:见 MANIFESTO "还没决定"一节。
