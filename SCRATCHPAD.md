# SCRATCHPAD — 写给未来的自己

> 工作日志,最新在上。
> 产品灵魂见 [MANIFESTO.md](MANIFESTO.md) —— 那份不轻易改;这份记录"我们走到哪了"。

## ▶ 下一步从这里继续

**🏁 黑客松提交:2026-06-21 上午 11:00 前。** 产品功能已全部完成,**重点是把现场 demo 演漂亮**(演示脚本见本文件 2026-06-20 下半段)。

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
