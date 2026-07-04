// 封存流程:write → date → seal → Edge Function(服务器端校验 + 写库)。
// 付款验证由 supabase/functions/seal-letter/index.ts 在服务器端完成——
// 客户端只传购买凭证 ID,服务器向 RevenueCat 确认后才落库。

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, Animated, Easing, findNodeHandle, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import AccountButton from '@/components/AccountButton';
import BottomSheet from '@/components/BottomSheet';
import Button from '@/components/Button';
import Calendar from '@/components/Calendar';
import Dateline from '@/components/Dateline';
import SealCeremony from '@/components/SealCeremony';
import SignIn from '@/components/SignIn';
import Splash from '@/components/Splash';
import { MIN_SEAL_DAYS } from '@/constants/rules';
import { colors, fonts, palette, spacing } from '@/theme';
import { compressVideoToFit, getVideoThumbnail, pickPhotos, pickVideo, randomFolder, uploadMedia, MAX_PHOTOS, type PickedMedia } from '@/lib/media';
import { purchaseTier, TIERS } from '@/lib/purchases';
import { supabase } from '@/lib/supabase';
import { tierFor } from '@/lib/tiers';

// 把日期"归零"到当天 00:00(本地时区)—— 我们按"整天"算,不掺时分秒。
function startOfDay(base: Date): Date {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  return d;
}

// 在某个日期上加 n 天,返回一个新日期(不改原来的)。
function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

// 按本地时区输出 'YYYY-MM-DD'(给数据库的 date 列;不用 toISOString,避免跨时区偏一天)。
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 把 Date 格式化成 'Mon D, YYYY'(例如 'Jun 22, 2027')给 SealSheet 展示。
function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// 把秒数格式化成 'm:ss'(例如 18 秒 → '0:18',75 秒 → '1:15')。
function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Pricing ladder shown in the SealSheet — three static info boxes (not tappable).
// These are informational only; the Seal button + "Seal as words only" link do the acting.
const LADDER = [
  { key: 'words',  label: 'Words',                lines: ['just text'] },
  { key: 'photos', label: 'Photos & Short Video', lines: ['up to 4 photos', '<30s video'] },
  { key: 'video',  label: 'Rich Media',           lines: ['up to 10 photos', '<5min video'] },
] as const;

// Tier ordering by "how much media" — used to explain why a tap can't switch tiers.
const TIER_RANK = { words: 0, photos: 1, video: 2 } as const;

// 草稿的本机存储键 + 开屏预填文案(判断「用户是否真的写过字」都以它为准)。
const DRAFT_KEY = 'reunite_draft';
const DRAFT_DEFAULT = 'Dear future me,\n\n';

// 生成唯一的上传文件名(如 photo-x7f2k9)。模块级纯工具 —— 组件内直接调 Math.random
// 会被 React Compiler 判为「渲染期不纯」而报错,提出来则只在事件处理器里执行。
function randomName(prefix: 'photo' | 'video'): string {
  return prefix + '-' + Math.random().toString(36).slice(2, 10);
}

export default function WriteScreen() {
  // 安全区内边距(刘海 / Home 指示条的真实高度)。
  // insets.top 用作 KeyboardAvoidingView 的 keyboardVerticalOffset:KAV 顶边被 SafeAreaView
  // 的顶部内边距往下推了 insets.top,'padding' 行为只按 KAV 自身坐标算重叠,会少抬这一截 ——
  // 把这一截作为 offset 补回去,Finish 按钮才能完全浮在键盘之上。
  // insets.bottom 在键盘收起时给底部栏垫开 Home 指示条的高度(键盘弹起时由键盘自身让位)。
  const insets = useSafeAreaInsets();

  // Track keyboard visibility so the footer's bottom padding doesn't waste space
  // when the keyboard is up (the home indicator is hidden behind the keyboard).
  // iOS: keyboardWillShow/Hide fires before the animation; Android: Did* fires after.
  const [keyboardShown, setKeyboardShown] = useState(false);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardShown(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardShown(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const [letter, setLetter] = useState('Dear future me,\n\n'); // 信里写了什么(开屏即预填称呼,可编辑)
  const [sealing, setSealing] = useState(false); // 正在播封存仪式动画?
  const [sealed, setSealed] = useState(false); // 封存了没?

  // 可选附件:最多 10 张照片 + 1 段视频(封存时一起上传)。
  const [photos, setPhotos] = useState<PickedMedia[]>([]);
  const [video, setVideo] = useState<PickedMedia | null>(null);
  const [busy, setBusy] = useState(false); // 正在上传媒体 + 写库(按 Seal 后那一下)

  // ── 即时后台压缩(像 Instagram/WhatsApp:选好视频那一刻就在后台压,用户继续写信)──
  // videoCompRef 记住「为哪一个原始 uri 起的压缩任务」+ 它的 Promise;封存时直接 await,
  // 已压完 → 立刻 resolve;还在压 → 只等这个进行中的任务(绝不重压)。
  // srcUri 守卫:用户换/删视频后,旧任务的结果会被忽略(stale)。
  const videoCompRef = useRef<{ srcUri: string; promise: Promise<string> } | null>(null);
  // videoStatus 只给 UI 用:'preparing' 显示「Preparing…」,'ready' 表示压好了。
  const [videoStatus, setVideoStatus] = useState<'idle' | 'preparing' | 'ready' | 'error'>('idle');
  // A poster frame from the picked video → shown instantly as a thumbnail while it compresses.
  const [videoThumb, setVideoThumb] = useState<string | null>(null);
  // 编码器的真实压缩进度(0..1)—— 缩略图上显示百分比,替代干转的圈。
  const [videoProgress, setVideoProgress] = useState(0);

  // ── 选片即传(eager upload,2026-07 提速核心)──
  // 老流程:点 Seal 后才开始逐张上传照片 + 上传 44MB 视频 → 用户盯着转圈 25-45 秒。
  // 新流程:照片选好那一刻、视频压完那一刻,就在后台悄悄上传;点 Seal 时基本都已传完,
  // prepareMedia 只是「收集结果」,等待近乎为零。上传目录整封信共用一个(uploadFolderRef),
  // 文件名用随机串(照片增删后序号会漂移,唯一名字永不互相覆盖)。
  // 用户中途放弃 → 留下孤儿文件,可接受(桶已清空过;后续加清理 cron)。
  const uploadFolderRef = useRef<string>(randomFolder());
  // 每张照片的后台上传任务:uri → Promise<公开 URL | null(失败,封存时并行重试)>。
  const photoUploadsRef = useRef<Map<string, Promise<string | null>>>(new Map());
  // 视频的「压缩→上传」整链任务(srcUri 守卫同 videoCompRef)。
  const videoUploadRef = useRef<{ srcUri: string; promise: Promise<string | null> } | null>(null);

  // busy 期间按钮下方的阶段文案:让 20 秒的等待「看得懂」,而不是无名转圈。
  const [busyPhase, setBusyPhase] = useState<'media' | 'purchase' | 'sealing' | null>(null);

  // 已付款但封存失败的凭证:重试时直接复用,绝不二次扣款(修复:老逻辑重试会再买一次)。
  const pendingTxRef = useRef<{ tier: 'words' | 'photos' | 'video'; transactionId: string } | null>(null);

  // 开场页:启动时先显示 Splash,点 Start 才进入写信页(只此一条出场路径,绝不自动跳转)。
  const [showSplash, setShowSplash] = useState(true);

  // 写信流程的两步:'write' = 写信 + 选附件;'date' = 安静地只选送达日 + 封存。
  const [step, setStep] = useState<'write' | 'date' | 'seal'>('write');
  // 每次打开选日期弹层就 +1 —— 用作日历的 key,强制重新挂载,月份回到当前月(RN Modal 关闭不卸载子组件,会残留旧月份)。
  const [pickerKey, setPickerKey] = useState(0);

  // 登录状态:session = 当前登录的人(没登录就是 null)。
  const [session, setSession] = useState<Session | null>(null);
  const [showSignIn, setShowSignIn] = useState(false); // 是否正在显示登录界面

  // 启动时读一次登录状态,并订阅之后的变化(登录/登出会自动更新)。
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // ── 草稿自动保存(「真实高于体面」:写了 40 分钟的真心话,绝不能因来电/切走被杀而消失)──
  // 启动时:本机存过草稿、且当前还是预填状态 → 恢复(绝不覆盖用户已在写的内容)。
  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY)
      .then((saved) => {
        if (saved && saved.trim() && saved !== DRAFT_DEFAULT) {
          setLetter((cur) => (cur === DRAFT_DEFAULT ? saved : cur));
        }
      })
      .catch(() => {});
  }, []);
  // 输入防抖写盘:停笔 800ms 才写一次(不逐键写);封存成功/再写一封时清除(见下)。
  useEffect(() => {
    const t = setTimeout(() => {
      AsyncStorage.setItem(DRAFT_KEY, letter).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [letter]);

  // 最早可选的送达日 = 今天(归零到 00:00)+ MIN_SEAL_DAYS 天。
  // 用 useMemo 按"今天是哪天"缓存:同一天内复用同一个对象(不每次按键都重算),
  // 跨过午夜后 todayStamp 变化才重算 —— 既省分配,又不会让下限悄悄少算一天。
  const todayStamp = startOfDay(new Date()).getTime();
  const earliest = useMemo(() => addDays(new Date(todayStamp), MIN_SEAL_DAYS), [todayStamp]);

  // 用户选的送达日;还没选时为 null,跟着 earliest 走。
  const [deliverOn, setDeliverOn] = useState<Date | null>(null);
  // The tier the user tapped on the Seal sheet (intent). Lets a paid tier light up
  // BEFORE any media exists, so we can then guide them to add a photo or a video.
  const [selectedTierKey, setSelectedTierKey] = useState<'words' | 'photos' | 'video' | null>(null);
  // Inline explanation shown when a tap can't switch tiers (e.g. too many photos for
  // the $2.99 tier). Cleared automatically whenever the media changes (see effect below).
  const [tierHint, setTierHint] = useState<string | null>(null);
  // 真正生效的日期:没选过就用 earliest;选过、但因跨午夜早于了 earliest,也夹回 earliest。
  const effectiveDate = deliverOn && deliverOn.getTime() >= earliest.getTime() ? deliverOn : earliest;

  // 日期已被 earliest + 选择器 minimumDate 夹在合法范围内,所以只剩"信不能为空"这一道闸。
  // 只有"称呼"还不算写了信 —— 要等用户在称呼之外真的写了字,底部才出现。
  const canSeal = letter.trim().length > 0 && letter.trim() !== 'Dear future me,';

  // 视频时长(秒),没有视频就是 0。
  const videoSeconds = video?.durationSec ?? 0;

  // 根据当前草稿内容计算定价档位(纯计算,实时响应)。
  const tierResult = useMemo(
    () =>
      tierFor({
        photoCount: photos.length,
        videoSeconds,
        // TODO: server-authoritative freeSealUsed — v1 固定传 false,
        // 等 Edge Function 接好后改从服务器读取。
        freeSealUsed: false,
      }),
    [photos.length, videoSeconds],
  );

  // 去掉媒体后的"纯文字"档位(用于判断要不要显示"Seal as words only"选项)。
  const wordsOnlyTier = useMemo(
    () =>
      tierFor({
        photoCount: 0,
        videoSeconds: 0,
        freeSealUsed: false,
      }),
    [],
  );
  // 只有当前有媒体(有更贵的档位)时,才显示"Seal as words only"备选。
  // ── Seal-sheet: the tiers are a live mirror of the capsule's content ──
  const hasMedia = photos.length > 0 || video !== null;
  const contentTierKey = tierResult.tier ?? 'words';
  // With media, the highlighted tier follows the content (honest). Before any media,
  // it follows what the user tapped, so a chosen paid tier stays lit while we guide.
  const effectiveTierKey = hasMedia ? contentTierKey : (selectedTierKey ?? 'words');
  const buttonPrice = hasMedia ? tierResult.priceHint : TIERS[effectiveTierKey].priceHint;
  // Chose a paid tier but nothing to charge for yet → we must guide, not seal-free silently.
  const paidSelectedNoMedia = !hasMedia && (selectedTierKey === 'photos' || selectedTierKey === 'video');
  // Adding/removing media changes the real tier, so any stale "can't switch" hint clears.
  useEffect(() => { setTierHint(null); }, [photos.length, video]);
  useEffect(() => { if (!video) setVideoThumb(null); }, [video]);

  // ── 核心封存逻辑(分两步,顺序至关重要) ──
  // 顺序:① 准备媒体(压缩 + 大小校验 + 上传,拿到公开 URL)→ ② 付款 → ③ 调
  // seal-letter Edge Function(服务器端验证购买 + 写库)。
  //
  // 为什么媒体必须在付款之前:压缩 / 大小校验 / 上传是会失败的步骤("视频太大"、
  // "上传失败")。如果放在付款之后,用户会先被扣款、再被告知媒体存不进去 ——
  // 扣了钱却没有信,这是绝不能发生的。所以先把媒体备好,任何媒体失败都在付款前暴露。
  // Edge Function 负责:身份验证、输入校验、免费次数检查、RevenueCat 购买验证、
  // 防重放攻击、最终写库。

  // prepareMedia — 在付款之前把照片 / 视频压缩 + 校验 + 上传,拿到公开 URL。
  // 任意一步失败(大小守卫触发,或某次上传返回 null)→ 弹出错误、返回 null,调用方
  // 据此中止流程、绝不调用 purchaseTier。成功 → 返回 { photoUrls, videoUrl }。
  // 压缩在 uploadMedia 内部发生;这里只做 randomFolder() + 逐个 uploadMedia 的循环。
  async function prepareMedia(
    mediaPhotos: PickedMedia[],
    mediaVideo: PickedMedia | null,
  ): Promise<{ photoUrls: string[]; videoUrl: string | null } | null> {
    // 2026-07 提速:媒体早在「选片即传」时就开始上传了(见 addPhotos/addVideo)。
    // 这里只是收集那些后台任务的结果 —— 都传完了就秒回;个别失败的并行重试一次。
    const folder = uploadFolderRef.current;
    const results = await Promise.all(
      mediaPhotos.map(async (m) => {
        const eager = photoUploadsRef.current.get(m.uri);
        const url = eager ? await eager : null;
        if (url) return url;
        // 后台没传过 / 传失败 → 现在重试(全部并行;换一个新随机名,避开半成品文件冲突)。
        const retry = uploadMedia(m, folder, 0, undefined, randomName('photo')).catch(
          () => null,
        );
        photoUploadsRef.current.set(m.uri, retry);
        return retry;
      }),
    );
    if (results.some((u) => !u)) {
      // 上传失败 → 千万别往下走付款。封存即消失,信一走用户永远发现不了图丢了。
      Alert.alert('Upload failed', "Your photos or video didn't upload. Please check your connection and try again.");
      return null; // 信还在、可重试,且尚未付款
    }
    const photoUrls = results as string[];
    let videoUrl: string | null = null;
    if (mediaVideo) {
      // 首选:取「选片即传」整链(压缩→上传)的结果 —— 通常早已传完,秒回。
      if (videoUploadRef.current?.srcUri === mediaVideo.uri) {
        try {
          videoUrl = await videoUploadRef.current.promise;
        } catch {
          videoUrl = null; // 后台链异常 → 走下面的现场兜底
        }
      }
      if (!videoUrl) {
        // 兜底(后台链没起过 / 失败):复用压缩结果(有就秒取,没有就现在压),再上传一次。
        // 全程 try/catch:绝不让异常把 prepareMedia 抛崩(否则 setBusy(false) 被跳过 → 按钮永远转圈)。
        let compressedUri: string;
        try {
          compressedUri =
            videoCompRef.current?.srcUri === mediaVideo.uri
              ? await videoCompRef.current.promise
              : await compressVideoToFit(mediaVideo.uri, mediaVideo.durationSec);
        } catch (e) {
          console.warn('[media] 后台压缩任务异常,封存时重试:', e);
          try {
            compressedUri = await compressVideoToFit(mediaVideo.uri, mediaVideo.durationSec);
          } catch {
            compressedUri = mediaVideo.uri; // 兜底用原片;太大会被 uploadMedia 的守卫拦下
          }
        }
        // 换一个新随机名重传(避开后台半成品文件的路径冲突)。
        videoUrl = await uploadMedia(
          mediaVideo,
          folder,
          0,
          compressedUri,
          randomName('video'),
        );
      }
      // null 可能是"视频太大"(uploadMedia 已弹自己的提示)或网络失败 —— 都中止。
      if (!videoUrl) {
        Alert.alert('Upload failed', "Your photos or video didn't upload. Please check your connection and try again.");
        return null; // 信还在、可重试,且尚未付款
      }
    }
    return { photoUrls, videoUrl };
  }

  // finalizeSeal — 媒体已上传、(如需)已付款之后的最后一步:调 seal-letter。
  // 这是唯一必须留在付款之后的步骤(它需要 transactionId 来验证购买)。
  // 服务器端函数会:验证 JWT 身份、校验输入、验证购买、防重放、写库。
  // 客户端不再直接往 letters 表 insert。
  //
  // 参数:
  //   sealTier       — 档位('words'|'photos'|'video'|null),null = 免费
  //   transactionId  — 购买凭证 ID(付款档位必须传,免费时 undefined)
  //   media          — prepareMedia 已经上传好的公开 URL(免费 / 纯文字时为空)
  async function finalizeSeal(
    sealTier: 'words' | 'photos' | 'video' | null,
    transactionId: string | undefined,
    media: { photoUrls: string[]; videoUrl: string | null },
  ) {
    const { photoUrls, videoUrl } = media;

    const { error } = await supabase.functions.invoke('seal-letter', {
      body: {
        body: letter.trim(),
        deliver_on: toISODate(effectiveDate),
        // 多张照片存成 JSON 数组字符串(没有就传 null);单段视频传 URL。
        photo_url: photoUrls.length ? JSON.stringify(photoUrls) : null,
        video_url: videoUrl,
        tier: sealTier,       // null = 免费;'words'/'photos'/'video' = 付款档位
        transactionId,        // 付款时从 purchaseTier() 拿到的商店交易 ID
        // 设备的 IANA 时区(写信此刻所在地);用于在送达日的本地 19:00 送达。
        deliver_tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });

    setBusy(false);
    setBusyPhase(null);
    if (error) {
      // invoke 失败时 error 是 FunctionsHttpError,它的 .message 只是笼统的
      // "Edge Function returned a non-2xx status code" —— 真正的服务器拒绝原因
      // (JSON { error, message })在 error.context(原始 Response)里。
      // 先读 context 的响应体,拿到服务器的真实原因,否则用户只看到一句没用的笼统报错。
      let msg = 'Something went sideways — your letter is safe. Please try again.';
      const res = (error as { context?: Response }).context;
      if (res && typeof res.json === 'function') {
        try {
          const parsed = (await res.json()) as { error?: string; message?: string };
          msg = parsed.message ?? parsed.error ?? msg;
        } catch {
          msg = error.message ?? msg; // 响应体不是 JSON → 退回 error.message
        }
      } else if (error.message) {
        msg = error.message;
      }
      console.log('封存失败:', msg);
      Alert.alert('Could not seal', msg, [{ text: 'OK' }]);
      return; // 没写成功就不切到"已封存"屏,信还在,可重试
    }

    // 封存成功 → 这封信的付款凭证已消费,清掉(下一封是全新的购买);本机草稿也功成身退。
    pendingTxRef.current = null;
    AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
    // 封存成功后顺手 nudge 一下 deliver(fire-and-forget,不阻塞封存动画)。
    // 生产环境无害:deliver 只送「已到期」的信 —— 刚封的未来信不会被送。
    // 审核期把服务器端 deliver 设成即时模式(DEMO_MODE),这一下就让审核员的信「秒到」邮箱。
    supabase.functions.invoke('deliver').catch(() => {});
    setSealing(true); // 写库成功 → 先播封存仪式动画,动画结束再切"已封存"屏
  }

  // 写信页的日期图标:主动打开日期底单(选完回写信页,图标显示所选日期)。
  function openDatePicker() {
    if (busy) return;
    Keyboard.dismiss(); // 先收键盘,免得它和弹层抢空间
    setPickerKey((k) => k + 1); // 让日历重新挂载,月份回到当前月
    setStep('date');
  }

  // 按「完成写信」:正在忙就忽略;信不能为空。
  // 快速路径(创始人设计):用户已通过日期图标主动选过日期 → 跳过日期底单,直进封存单
  //(封存单上的 Returning 行可点回来改 —— 反悔的路必须在,才允许跳)。
  // 没主动选过 → 照旧进"选日期"那一屏(这里不问登录)。
  function handleFinish() {
    if (busy) return;
    if (!letter.trim()) return;
    Keyboard.dismiss(); // 先收键盘,免得它和弹层抢空间
    if (deliverOn != null) {
      handleSeal(); // 已有明确日期 → 登录检查后直进封存单
      return;
    }
    setPickerKey((k) => k + 1); // 让日历重新挂载,月份回到当前月
    setStep('date');
  }

  // 按「封存」:正在忙就忽略;没登录就先弹登录;已登录就打开付款底单。
  function handleSeal() {
    if (busy) return;
    if (!session) {
      setShowSignIn(true);
      return;
    }
    // 打开 SealSheet(付款 + 确认底单)。
    setStep('seal');
  }

  // SealSheet 里按下主按钮「Seal · {price}」时的逻辑。
  // 顺序(致命修复):准备媒体(压缩 + 大小校验 + 上传)→ 付款 → 写库。
  // 媒体的所有失败点都在付款之前暴露,杜绝"先扣款、再说视频太大 / 上传失败"。
  async function handleSealSheet() {
    if (busy) return;

    setBusy(true); // 整个流程(准备媒体 + 付款 + 写库)期间,按钮转圈、防重复点
    setBusyPhase('media'); // 阶段文案:让等待「看得懂」

    // ── 第一步:收集媒体(在任何付款之前)──
    // 「选片即传」通常早已传完 → 这里秒回;个别失败会并行重试。任何失败 → 中止,绝不付款。
    const media = await prepareMedia(photos, video);
    if (!media) {
      setBusy(false);
      setBusyPhase(null);
      return; // 媒体没备好(太大 / 上传失败)→ 信还在、可重试,且尚未付款
    }

    if (tierResult.isFree) {
      // 免费:跳过付款,tier = null,不需要 transactionId。finalizeSeal 会 setBusy(false)。
      setBusyPhase('sealing');
      await finalizeSeal(null, undefined, media);
      return;
    }

    // DEMO FALLBACK:购买功能在 web / 无密钥时被禁用。
    // 为了让 /app 演示页和 Expo Go 体验能正常封存,遇到 'purchases disabled' 就跳过付款,
    // 用 null tier(免费路径)调 seal-letter。服务器会按免费规则校验。
    // 真实 App Store 构建有密钥时不会走这条路。
    if (Platform.OS === 'web') {
      // web 演示:跳过付款,tier = null(免费路径)。
      setBusyPhase('sealing');
      await finalizeSeal(null, undefined, media);
      return;
    }

    // ── 第二步:付款 ──
    // 媒体此时已上传成功;现在才触发购买弹窗。
    const tier = tierResult.tier!;

    // 防双扣款(2026-07 修复):上一次「付了款但封存失败」留下的凭证还在 → 直接复用,
    // 跳过购买弹窗。老逻辑重试会再买一次 —— 用户被扣两次钱,第一笔成了孤儿交易。
    // 服务器端 used_transactions 失败时会回滚锁,所以同一笔凭证重试封存是安全的。
    if (pendingTxRef.current?.tier === tier) {
      setBusyPhase('sealing');
      await finalizeSeal(tier, pendingTxRef.current.transactionId, media);
      return;
    }

    setBusyPhase('purchase');
    const result = await purchaseTier(tier);

    if (result.ok) {
      // ── 第三步:付款成功 → 写库(唯一必须在付款之后的步骤,需 transactionId 验购)──
      // 先把凭证记下来:万一 finalizeSeal 失败,重试直接复用,绝不二次扣款。
      pendingTxRef.current = { tier, transactionId: result.transactionId! };
      setBusyPhase('sealing');
      await finalizeSeal(tier, result.transactionId, media);
    } else if (result.cancelled) {
      // 用户取消付款 → 留在底单。已上传的媒体成为存储里的孤儿文件 ——
      // 目前可接受(后续可加 best-effort 清理:删 media.folder 下的对象);不阻塞流程。
      setBusy(false);
      setBusyPhase(null);
      return;
    } else if (result.error === 'purchases disabled') {
      // Demo fallback:购买模块未启用(无密钥的测试构建)→ 免费路径封存。
      // Demo fallback — real App Store builds have purchases enabled.
      setBusyPhase('sealing');
      await finalizeSeal(null, undefined, media);
    } else {
      // 其他错误(网络失败、App Store 异常等) → 温和提示,留在底单。
      // (媒体已上传,同样成为可接受的孤儿文件;详见上面取消分支的说明。)
      setBusy(false);
      setBusyPhase(null);
      // 错误文案人味化:绝不把 RevenueCat/StoreKit 的原始报错甩给用户。
      const friendly =
        result.error && /network|internet|offline|connection/i.test(result.error)
          ? "You're offline. Your letter is safe — try again in a moment."
          : "The purchase didn't go through and nothing was charged. Please try again.";
      Alert.alert('Something went wrong', friendly, [{ text: 'OK' }]);
    }
  }

  // "Seal as words only": seal with text only, dropping all media from the capsule.
  function handleWordsOnly() {
    // Build a plain-English description of what will be left behind.
    const mediaParts: string[] = [];
    if (photos.length > 0) mediaParts.push(photos.length === 1 ? '1 photo' : `${photos.length} photos`);
    if (video !== null) mediaParts.push('a video');
    const mediaDesc = mediaParts.join(' and ');

    Alert.alert(
      'Seal words only?',
      `Your ${mediaDesc} won't be included — but nothing is deleted; ${photos.length + (video ? 1 : 0) > 1 ? 'they stay' : 'it stays'} safe in your phone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Seal words only',
          // Not style:'destructive' — this is a confirmation, not a dangerous action.
          onPress: async () => {
            if (busy) return;
            setBusy(true); // 付款 + 写库期间转圈、防重复点
            // 确定用纯文字档位(wordsOnlyTier.tier 可能是 null 或 'words')。
            // 纯文字 = 无媒体,所以没有 prepareMedia 步骤(空媒体直接写库)。
            const emptyMedia = { photoUrls: [], videoUrl: null };
            if (wordsOnlyTier.isFree) {
              // 纯文字 + 免费条件满足 → 免费封存(finalizeSeal 会 setBusy(false))。
              await finalizeSeal(null, undefined, emptyMedia);
            } else {
              // 纯文字但需要付款(例如时间跨度 > 365 天) → 无媒体可丢,先购买再写库。
              const result = await purchaseTier('words');
              if (result.ok) {
                await finalizeSeal('words', result.transactionId, emptyMedia);
              } else if (result.cancelled) {
                setBusy(false);
                return; // 取消 → 留在底单
              } else if (result.error === 'purchases disabled') {
                await finalizeSeal(null, undefined, emptyMedia); // web demo fallback
              } else {
                setBusy(false);
                Alert.alert('Something went wrong', result.error ?? 'The purchase could not be completed.', [{ text: 'OK' }]);
              }
            }
            // 只清草稿里的媒体引用(不碰相册里的文件)。
            setPhotos([]);
            setVideo(null);
            // 纯文字封存:丢掉视频 → 也忘掉后台压缩任务,状态回 idle。
            videoCompRef.current = null;
            setVideoStatus('idle');
          },
        },
      ],
    );
  }

  // 选照片(可多选,最多补到 10 张)/ 1 段视频(从相册)。
  async function addPhotos() {
    const picked = await pickPhotos(MAX_PHOTOS - photos.length);
    if (!picked.length) return;
    setPhotos((prev) => [...prev, ...picked].slice(0, MAX_PHOTOS));
    // 选片即传:选好那一刻就在后台上传,用户继续写信;点 Seal 时早已传完。
    for (const m of picked) {
      if (!photoUploadsRef.current.has(m.uri)) {
        photoUploadsRef.current.set(
          m.uri,
          uploadMedia(m, uploadFolderRef.current, 0, undefined, randomName('photo')).catch(
            () => null,
          ),
        );
      }
    }
  }
  async function addVideo() {
    const m = await pickVideo();
    if (!m) return;
    setVideo(m);
    // Instant poster frame for the thumbnail (best-effort; null → graceful blank cell).
    setVideoThumb(null);
    getVideoThumbnail(m.uri).then(setVideoThumb).catch(() => {});
    // 选好的那一刻就在后台启动压缩(带真实进度回调),用户继续写信。
    // (web / Expo Go 上 compressVideoToFit 是 no-op,Promise 立刻 resolve 原 uri。)
    setVideoProgress(0);
    const promise = compressVideoToFit(m.uri, m.durationSec, (p) => {
      // srcUri 守卫:只在「这仍是当前选中的视频」时更新进度(避免 stale 任务覆盖)。
      if (videoCompRef.current?.srcUri === m.uri) setVideoProgress(p);
    });
    videoCompRef.current = { srcUri: m.uri, promise };
    setVideoStatus('preparing');
    // 压缩一落地就静默接力上传(压缩→上传整链存进 videoUploadRef,封存时直接取结果)。
    const uploadPromise = promise
      .then((compressed) =>
        uploadMedia(m, uploadFolderRef.current, 0, compressed, randomName('video')),
      )
      .catch(() => null);
    videoUploadRef.current = { srcUri: m.uri, promise: uploadPromise };
    promise
      .then(() => {
        if (videoCompRef.current?.srcUri === m.uri) setVideoStatus('ready');
      })
      .catch(() => {
        if (videoCompRef.current?.srcUri === m.uri) setVideoStatus('error');
      });
  }

  // The video's thumbnail cell (shown in the media strips like a photo): poster frame +
  // a small film badge, a spinning ring while it compresses, and a ✕ to remove.
  function renderVideoThumb() {
    if (!video) return null;
    return (
      <View style={styles.thumbWrap}>
        {videoThumb ? (
          <Image source={{ uri: videoThumb }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.videoThumbBlank]} />
        )}
        {videoStatus === 'preparing' ? (
          <View style={styles.videoThumbOverlay}>
            {/* 真实压缩进度:编码器亲口说的百分比,不是干转的圈。进度未就绪(0)时仍显示圈。 */}
            {videoProgress > 0 ? (
              <Text style={styles.videoPctText}>{Math.round(videoProgress * 100)}%</Text>
            ) : (
              <ActivityIndicator size="small" color={colors.brand} />
            )}
          </View>
        ) : (
          // A centered play button = the universal "this is a video" cue (clearer than a
          // tiny corner film icon). pointerEvents:none so it never eats the ✕ / taps.
          <View style={styles.videoPlayWrap} pointerEvents="none">
            <View style={styles.videoPlayDisc}>
              <Ionicons name="play" size={12} color={colors.surfacePaper} style={styles.videoPlayIcon} />
            </View>
          </View>
        )}
        <Pressable
          onPress={() => { setVideo(null); videoCompRef.current = null; setVideoStatus('idle'); }}
          disabled={busy}
          hitSlop={14}
          style={styles.thumbRemove}
          accessibilityRole="button"
          accessibilityLabel="Remove video">
          <Text style={styles.thumbRemoveText}>✕</Text>
        </Pressable>
      </View>
    );
  }

  // Tap a pricing tier on the Seal sheet. The tiers mirror your content, so a tap
  // changes the content, not a hidden "selection":
  //  - a paid tier → open the photo picker (a video can follow via the row below);
  //  - Words (when you have media) → confirm, drop the media, seal words only.
  function onTapTier(key: 'words' | 'photos' | 'video') {
    if (busy) return;
    setTierHint(null);
    if (key === 'words') {
      if (hasMedia) handleWordsOnly();   // drop media → seal words only (confirm)
      else setSelectedTierKey('words');
      return;
    }
    // Paid tier tapped.
    if (!hasMedia) {
      // No media yet → select it; the guidance below helps them add photos/video.
      setSelectedTierKey(key);
      return;
    }
    // Media present: the tier follows the content, so a tap can't just "switch".
    // Explain why + how to fix — no dead taps.
    const diff = TIER_RANK[key] - TIER_RANK[contentTierKey];
    if (diff < 0) {
      // Content outgrew this cheaper tier (e.g. >4 photos, tapping the $2.99 box).
      setTierHint('Photos & Short Video fits up to 4 photos and a 30-second video. Remove some to switch to $2.99.');
    } else if (diff > 0) {
      // Tapped a richer tier than the current media warrants.
      setTierHint('Rich Media holds up to 10 photos and a video up to 5 minutes — add more to switch to $5.99.');
    }
    // diff === 0: already on this tier, nothing to do.
  }

  // 封存之后想再写一封:清空内容 + 清掉附件,回到全新写信屏(但仍保持登录)。
  function writeAnother() {
    setLetter(DRAFT_DEFAULT);
    AsyncStorage.removeItem(DRAFT_KEY).catch(() => {}); // 新的一封,旧草稿清场
    setDeliverOn(null);
    setSealed(false);
    setSelectedTierKey(null);
    setTierHint(null);
    setPhotos([]);
    setVideo(null);
    // 再写一封:清掉上一封的后台压缩/上传任务,换全新上传目录,状态回 idle。
    videoCompRef.current = null;
    videoUploadRef.current = null;
    photoUploadsRef.current = new Map();
    uploadFolderRef.current = randomFolder();
    pendingTxRef.current = null;
    setVideoProgress(0);
    setVideoStatus('idle');
    setStep('write');
  }

  // 登出 / 换邮箱:确认后退出登录。草稿保留,下次封存会重新问邮箱。
  function confirmSignOut() {
    Alert.alert('Sign out?', "Your draft stays. You'll choose an email again when you seal.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  }

  // A2: 封存完成时把 VoiceOver 焦点移到标题 + 播报封存成功。
  // 重要:必须在任何 if(...) return 之前声明,否则点 Start 切屏时 Hook 数量变化会崩溃(Rules of Hooks)。
  const sealedHeadingRef = useRef<Text>(null);
  // 已封存屏的入场:整块内容从上方 16px 轻轻降落 + 渐现(ease-out,一次性)。
  const sealedIntro = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!sealed) return;
    sealedIntro.setValue(0);
    Animated.timing(sealedIntro, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [sealed, sealedIntro]);
  useEffect(() => {
    if (!sealed) return;
    // 播报给屏幕阅读器用户
    AccessibilityInfo.announceForAccessibility('Your letter is sealed. It will return to you in the future.');
    // 把 VoiceOver 焦点移动到"Sealed"标题
    const tag = findNodeHandle(sealedHeadingRef.current);
    if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
  }, [sealed]);

  // 岔路口⓪⁻:开场页 —— 启动先显示 Splash,只有点 Start 才进入(无自动跳转)。
  if (showSplash) {
    return <Splash onStart={() => setShowSplash(false)} />;
  }

  // 岔路口⓪:正在登录 → 显示登录界面(输邮箱 → 收码 → 验证)。
  if (showSignIn) {
    return (
      <SignIn
        onCancel={() => setShowSignIn(false)}
        onVerified={() => {
          setShowSignIn(false);
          // 验证刚通过,登录信息已就位,打开付款底单(主人由数据库自动填)。
          setStep('seal');
        }}
      />
    );
  }

  // 岔路口①ʹ:正在播封存仪式 → 火漆盖章 → 信飘走消失,结束后切"已封存"屏。
  if (sealing) {
    return (
      <SealCeremony
        onDone={() => {
          setSealing(false);
          setSealed(true);
        }}
      />
    );
  }

  // 岔路口①:已封存 → 写信的纸消失,只剩一句安静的话。
  if (sealed) {
    return (
      <SafeAreaView style={styles.sealedScreen} edges={['top', 'bottom']}>
        {/* 内容居中:信封 + 标题 + 描述。入场 = 渐现 + 自上而下轻降(ease-out)。 */}
        <Animated.View
          style={[
            styles.sealedContent,
            {
              opacity: sealedIntro,
              transform: [{ translateY: sealedIntro.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }],
            },
          ]}>
          {/* A7: 装饰性信封图片,对屏幕阅读器隐藏 */}
          <Image source={require('@/assets/images/sealed-envelope.png')} style={styles.sealedLogo} resizeMode="contain" accessible={false} importantForAccessibility="no-hide-descendants" />
          {/* A2: accessibilityLiveRegion="assertive" 确保 Android TalkBack 也能立即播报;ref 用于 iOS VoiceOver 焦点 */}
          <Text ref={sealedHeadingRef} style={styles.sealedText} accessibilityLiveRegion="assertive">Your letter is sealed</Text>
          {/* 一段话:邮箱 + 日期织进那句诗里(这是日期最后一次露面 —— 之后信就消失了)。 */}
          {session?.user?.email ? (
            <Text style={styles.sealedHint}>
              It will return to <Text style={styles.sealSheetItemBrand}>{session.user.email}</Text> on{' '}
              <Text style={styles.sealSheetItemBrand}>{formatDate(effectiveDate)}</Text> — a day you'll have long forgotten.
            </Text>
          ) : (
            <Text style={styles.sealedHint}>It will find its way back to you — on a day you've long forgotten.</Text>
          )}
        </Animated.View>

        {/* 底部按钮:与写信页 Seal 按钮同款(实心主题色、直角、近白文字),但更窄更精致。 */}
        <View style={styles.sealedFooter}>
          <Button label="Write another letter" onPress={writeAnother} style={styles.sealedButton} />
        </View>
      </SafeAreaView>
    );
  }

  // 选送达日不再单独占一屏 —— 改成从底部滑上来的纸张底单(step==='date' 时浮在写信纸之上)。

  // 岔路口②:还没封存 → 写信 + 选附件 + 「Finish」(日期 / 封存以弹层形式出现)。
  return (
    // 只让 SafeAreaView 处理顶部安全区;底部安全区(Home 指示条)交给底部栏自己垫,
    // 这样 KeyboardAvoidingView 的底边能贴到屏幕真实底部,'padding' 才能算对键盘重叠。
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* 干净纯色底(#FAE6C9)—— 去掉纸张质感 + 呼吸层(用户要求)。 */}
      <View style={styles.flex}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          // KAV 顶边被顶部安全区往下推了 insets.top —— 把这一截补给键盘重叠计算,Finish 才不被遮。
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}>
          {/* 可滚动的信纸:头像 + 邮戳 + 分割线 + 正文一起滚动。写得越多越往上退,腾出更大的写信区(用户要求:日期/头像不必一直钉在顶部)。 */}
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}>
            {/* 账号头像(蜡封):绝对定位在滚动内容的右上角,随内容一起上滑 —— 不再固定在角上与分割线打架(用户要求)。 */}
            {session ? <AccountButton email={session.user.email!} onSignOut={confirmSignOut} /> : null}

            {/* 顶部邮戳:日期 / 可编辑城市 / 时间(此刻的你)。长按日期 = 演示用回到开场页。 */}
            <Dateline onLongPress={() => setShowSplash(true)} />

            {/* 顶部邮戳与信之间的分割线:两段细金线 + 中间金色星(代码画,稳定渲染)。A7: 纯装饰,对屏幕阅读器隐藏 */}
            <View style={styles.dividerRow} accessible={false} importantForAccessibility="no-hide-descendants">
              <View style={styles.dividerLine} />
              <Text style={styles.dividerStar}>✦</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* 整封信(含称呼)都在这一个输入框里写,同一字体同一字号;光标是暖金棕色。 */}
            {/* scrollEnabled=false → 交给外层 ScrollView 统一滚动,邮戳才能随内容上退。 */}
            {/* A1: accessibilityLabel 让屏幕阅读器知道这是写给未来自己的信 */}
            <TextInput
              style={styles.input}
              value={letter}
              onChangeText={setLetter}
              multiline
              scrollEnabled={false}
              autoFocus
              textAlignVertical="top"
              selectionColor={colors.cursor}
              cursorColor={colors.cursor}
              accessibilityLabel="Your letter"
            />
          </ScrollView>

          {/* 底部固定栏:附件按钮 + Finish。固定在键盘上方,绝不被键盘遮住(用户要求)。
              还没写字时整条隐藏 —— 守"一张干净的纸"。 */}
          {canSeal ? (
            // 底部栏自己垫开 Home 指示条:键盘收起时 Finish 不压在指示条上;
            // 键盘弹起时 KAV 把整条抬到键盘之上,这截内边距也跟着一起抬。
            <View style={[styles.footer, { paddingBottom: keyboardShown ? 8 : 20 + insets.bottom }]}>
              {/* 已选的照片:一排小"相片",固定在 ＋Photos 上方、完整可见,让用户加完即可确认(不被遮挡、无需下拉)。 */}
              {(photos.length > 0 || video) ? (
                <View style={styles.thumbs}>
                  {photos.map((p, idx) => (
                    <View key={p.uri + idx} style={styles.thumbWrap}>
                      <Image source={{ uri: p.uri }} style={styles.thumb} />
                      {/* A8: hitSlop 扩到 14pt + accessibilityLabel,屏幕阅读器播报"Remove photo" */}
                      <Pressable
                        onPress={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                        disabled={busy}
                        hitSlop={14}
                        style={styles.thumbRemove}
                        accessibilityRole="button"
                        accessibilityLabel="Remove photo">
                        <Text style={styles.thumbRemoveText}>✕</Text>
                      </Pressable>
                    </View>
                  ))}
                  {renderVideoThumb()}
                </View>
              ) : null}

              {/* 可选附件:照片(可多选,最多 10 张)+ 1 段视频。安静一行,守"写信为主"。 */}
              {/* A9: 媒体按钮加上 hitSlop 和 accessibilityLabel */}
              <View style={styles.mediaRow}>
                {/* Same icon+label style as the Seal sheet — one media control across the app. */}
                {photos.length < MAX_PHOTOS ? (
                  <Pressable style={styles.mediaGhostBtn} onPress={addPhotos} disabled={busy} accessibilityRole="button" hitSlop={{ top: 10, bottom: 10 }} accessibilityLabel="Add photos">
                    <Ionicons name="images-outline" size={18} color={colors.brand} />
                    <Text style={styles.mediaGhostLabel}>Photos</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.mediaCap}>That's all 10 — a full capsule.</Text>
                )}
                {!video ? (
                  <Pressable style={styles.mediaGhostBtn} onPress={addVideo} disabled={busy} accessibilityRole="button" hitSlop={{ top: 10, bottom: 10 }} accessibilityLabel="Add a video">
                    <Ionicons name="film-outline" size={18} color={colors.brand} />
                    <Text style={styles.mediaGhostLabel}>Video</Text>
                  </Pressable>
                ) : null}
                {/* 送达日:信封信息的第三员(创始人设计)。没选过显示 "Date";
                    主动选过就直接显示日期(高亮),随时可点回日期底单修改。 */}
                <Pressable style={styles.mediaGhostBtn} onPress={openDatePicker} disabled={busy} accessibilityRole="button" hitSlop={{ top: 10, bottom: 10 }} accessibilityLabel={deliverOn ? `Delivery date ${formatDate(effectiveDate)}, tap to change` : 'Choose a delivery date'}>
                  <Ionicons name="calendar-outline" size={18} color={colors.brand} />
                  <Text style={[styles.mediaGhostLabel, deliverOn != null && styles.mediaGhostOn]}>
                    {deliverOn ? formatDate(effectiveDate) : 'Date'}
                  </Text>
                </Pressable>
              </View>

              {/* 写完了 → 进入选日期那一屏(这里不封存、不问登录)。 */}
              <Button label="Finish" onPress={handleFinish} />
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </View>

      {/*
        选送达日:从底部滑上来的纸张底单(BottomSheet)。可点遮罩、也可下拉关闭。
        关闭 = 回去继续写(step → 'write');底单内部不会误关。
      */}
      {/*
        日期 + 定价合并为「一个」BottomSheet:visible 覆盖 date 和 seal 两步,
        内部按 step 切换内容。这样 date→seal 只是换内容,不会出现「两个 Modal 同时
        一个关一个开」的 iOS 冲突(那会导致退回写信页、且之后 Finish 卡死)。
        onClose(点遮罩 / 下拉)= 直接回写信页;seal 的「Keep writing」回到日历(同一底单内)。
      */}
      <BottomSheet visible={step === 'date' || step === 'seal'} onClose={() => setStep('write')}>
        {step === 'date' ? (
          <>
            <Text style={styles.dateHero}>When should it return to you?</Text>

            {/* 标题下方一根浅浅的分割线(#EFDFC0),把标题和日历轻轻分开。 */}
            <View style={styles.dateHeroDivider} />

            {/* 自制 Courier Prime 月历:没选中前空着,选一天 → 归零存进 deliverOn。 */}
            <Calendar key={pickerKey} value={deliverOn} minDate={earliest} onChange={(d) => setDeliverOn(startOfDay(d))} />

            {/* 选了日子才点得动 Seal —— 空月历 + 灰按钮自然引导用户先点一天。 */}
            <Button
              label="Seal"
              onPress={handleSeal}
              disabled={!deliverOn}
              loading={busy}
              style={styles.sealButtonInSheet}
            />
            {/* No "Keep writing" button — swipe down or tap outside the sheet returns to
                writing (onClose → step 'write'). The grabber handle hints at the gesture. */}
          </>
        ) : (
          <>
        {/* 标题 */}
        <Text style={styles.sealSheetTitle}>Seal this capsule</Text>

        {/* 信件摘要清单(2026-07-04 紧凑版):两行说完 ——
            第 1 行:内容(Your words · 3 photos · a 0:30 video,只列非零项);
            第 2 行:Returning 日期(可点改期,点线下划线)· to 邮箱。 */}
        <View style={styles.sealSheetInventory}>
          <Text style={styles.sealSheetItem}>
            {[
              'Your words',
              photos.length === 1 ? '1 photo' : photos.length > 1 ? `${photos.length} photos` : null,
              video !== null ? `a ${formatDuration(videoSeconds > 0 ? videoSeconds : 0)} video` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <Text style={styles.sealSheetItem}>
            {/* 嵌套 Text 的 onPress:只有 "Returning 日期" 这一段可点(改期);邮箱只是信任展示。 */}
            <Text
              style={styles.sealSheetItemTappable}
              onPress={() => { if (!busy) { setPickerKey((k) => k + 1); setStep('date'); } }}
              suppressHighlighting
              accessibilityRole="button"
              accessibilityLabel={`Returning ${formatDate(effectiveDate)}, tap to change the date`}>
              Returning <Text style={styles.sealSheetItemBrand}>{formatDate(effectiveDate)}</Text>
            </Text>
          </Text>
          {/* 第 3 行:回信邮箱单独一行(拼在日期后会尴尬地折行)。 */}
          {session?.user?.email ? (
            <Text style={styles.sealSheetItem}>
              to <Text style={styles.sealSheetItemBrand}>{session.user.email}</Text>
            </Text>
          ) : null}
        </View>

        {/* 分割线:细金 */}
        <View style={styles.sealSheetDivider} />

        {/* Title line + tier boxes are ONE group. The sheet's own gap:18 would otherwise
            push them apart, so we wrap them and control the inner spacing ourselves. */}
        <View style={styles.pricingGroup}>
        <Text style={styles.oneTimeNote}>A one-time charge, never a subscription.</Text>
        {/* Pricing tiers = a live mirror of your capsule (highlight = current tier).
            Tap a paid tier to add its media; tap Words to keep it text-only. */}
        <View style={styles.sealSheetLadder}>
          {LADDER.map(({ key, label, lines }) => {
            const active = key === effectiveTierKey;
            const price = TIERS[key].priceHint;
            return (
              <Pressable
                key={key}
                onPress={() => onTapTier(key)}
                disabled={busy}
                style={({ pressed }) => [styles.ladderBox, active && styles.ladderBoxActive, pressed && styles.ladderBoxPressed]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${TIERS[key].label}, ${price}, ${TIERS[key].description}`}>
                <Text style={[styles.ladderLabel, active && styles.ladderLabelActive]}>{label}</Text>
                {lines.map((l) => (
                  <Text key={l} style={[styles.ladderLine, active && styles.ladderLineActive]}>{l}</Text>
                ))}
                <Text numberOfLines={1} style={[styles.ladderPrice, active && styles.ladderPriceActive]}>{price}</Text>
              </Pressable>
            );
          })}
        </View>
        {/* A gentle "can't switch to this tier" notice — faint warm callout, left-aligned,
            with a warm accent bar so it reads as an explanation, not scattered text.
            Kept INSIDE pricingGroup so it hugs the tier boxes (the sheet's gap:18 would
            otherwise push it far below). */}
        {tierHint ? (
          <View style={styles.tierNotice}>
            <Text style={styles.tierNoticeText}>{tierHint}</Text>
          </View>
        ) : null}
        </View>

        {/* Media preview: what you added, each removable. */}
        {(photos.length > 0 || video) ? (
          <View style={[styles.thumbs, styles.thumbsSeal]}>
            {photos.map((p, idx) => (
              <View key={p.uri + idx} style={styles.thumbWrap}>
                <Image source={{ uri: p.uri }} style={styles.thumb} />
                <Pressable
                  onPress={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                  disabled={busy}
                  hitSlop={14}
                  style={styles.thumbRemove}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo">
                  <Text style={styles.thumbRemoveText}>✕</Text>
                </Pressable>
              </View>
            ))}
            {renderVideoThumb()}
          </View>
        ) : null}

        {/* Empty PAID state → a prominent "add a moment" well: a hairline paper well with
            two quiet outline buttons (line icon + label). Design-reviewed: no filled card,
            no shadow, icon-left-of-label, so it reads like paper, not an upload widget. */}
        {paidSelectedNoMedia ? (
          <>
            <View style={styles.mediaWell}>
              <Text style={styles.wellHint}>Add photos or a video for this tier.</Text>
              <View style={styles.wellButtons}>
                <Pressable style={({ pressed }) => [styles.mediaBtn, pressed && styles.mediaBtnPressed]} onPress={addPhotos} disabled={busy} accessibilityRole="button" accessibilityLabel="Add photos">
                  <Ionicons name="images-outline" size={19} color={colors.brand} />
                  <Text style={styles.mediaBtnLabel}>Photos</Text>
                </Pressable>
                <Pressable style={({ pressed }) => [styles.mediaBtn, pressed && styles.mediaBtnPressed]} onPress={addVideo} disabled={busy} accessibilityRole="button" accessibilityLabel="Add a video">
                  <Ionicons name="film-outline" size={19} color={colors.brand} />
                  <Text style={styles.mediaBtnLabel}>Video</Text>
                </Pressable>
              </View>
            </View>
            {/* A quiet, un-underlined fallback to the free words-only path (not a loud link). */}
            <Pressable onPress={handleSealSheet} disabled={busy} accessibilityRole="button" hitSlop={{ top: 10, bottom: 10 }} style={styles.wellFreeWrap}>
              <Text style={styles.wellFree}>Or seal your words alone for free.</Text>
            </Pressable>
          </>
        ) : null}

        {/* Has-media → thumbnails show above; a quiet add-more row (a video can follow photos). */}
        {hasMedia ? (
          <View style={styles.sealMediaRow}>
            {photos.length < MAX_PHOTOS ? (
              <Pressable style={styles.mediaGhostBtn} onPress={addPhotos} disabled={busy} accessibilityRole="button" hitSlop={{ top: 10, bottom: 10 }} accessibilityLabel="Add photos">
                <Ionicons name="images-outline" size={18} color={colors.brand} />
                <Text style={styles.mediaGhostLabel}>Photos</Text>
              </Pressable>
            ) : (
              <Text style={styles.mediaCap}>That's all 10 — a full capsule.</Text>
            )}
            {!video ? (
              <Pressable style={styles.mediaGhostBtn} onPress={addVideo} disabled={busy} accessibilityRole="button" hitSlop={{ top: 10, bottom: 10 }} accessibilityLabel="Add a video">
                <Ionicons name="film-outline" size={18} color={colors.brand} />
                <Text style={styles.mediaGhostLabel}>Video</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Primary Seal button — hidden in the empty-paid state (nothing to charge yet). */}
        {paidSelectedNoMedia ? null : (
          <>
            <Button
              label={`Seal · ${buttonPrice}`}
              onPress={handleSealSheet}
              loading={busy}
              style={styles.sealButtonInSheet}
            />
            {/* 阶段文案:等待时告诉用户「正在发生什么」,无名转圈才是焦虑之源。 */}
            {busy && busyPhase ? (
              <Text style={styles.busyPhaseText}>
                {busyPhase === 'media'
                  ? video
                    ? 'Preparing your video…'
                    : 'Preparing your photos…'
                  : busyPhase === 'purchase'
                    ? 'Confirming your purchase…'
                    : 'Sealing…'}
              </Text>
            ) : null}
          </>
        )}
          </>
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.background }, // 干净纯色底(用户指定)

  // 顶部邮戳与信之间的分割线:两段细金线 + 中间金色星,与正文同样 32 页边距。
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 32, marginTop: 12, marginBottom: 12, gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.accentGold, opacity: 0.45 }, // 压浅:装饰退后,别抢正文
  dividerStar: { fontFamily: fonts.regular, color: colors.accentGold, fontSize: 13, marginTop: -2 , opacity: 0.55 },

  // 整封信:打字机字体 Courier Prime,暖色墨。称呼是这封信的第一行,同字体同字号。
  // paddingTop 让第一行("Dear future me,")落在邮戳下方、原先题头开始的位置,留出干净的留白。
  // 写信区在 ScrollView 里:flexGrow 让它在内容少时也撑满整页(随手点都能写),
  // 内容多时自适应增高、由外层 ScrollView 统一滚动(邮戳随之上退)。
  scrollBody: { flexGrow: 1 },
  input: {
    flexGrow: 1,
    minHeight: 240,
    paddingHorizontal: 32,
    paddingTop: 0, // 上间距交给分割线(marginBottom 12),让分割线上下对称
    paddingBottom: 24,
    fontFamily: fonts.regular,
    fontSize: 16, // 正文字号恢复到 16(用户)
    lineHeight: 23, // 行/段落间距收紧(原 26);光标高度跟随行高
    letterSpacing: -0.5, // 等宽字体唯一能收紧"词间距"的办法:整体微微收紧(字母几乎不变)
    color: colors.textBody,
  },

  footer: { paddingHorizontal: 32, paddingVertical: 16, gap: 10 },
  mediaRow: { flexDirection: 'row', gap: 22, paddingBottom: 2 },
  mediaAdd: { fontSize: 14, color: colors.textMuted }, // 未选:暖灰
  mediaOn: { fontSize: 14, color: colors.brandText }, // B: 已选 — 换用 brandText(#84410F),达到 ≥4.5:1(AA)
  // 后台压缩中:低调暖灰 + 斜体「Preparing…」,与 mediaCap 同色系,不抢戏(纸感、安静)。
  mediaPreparing: { fontSize: 14, color: colors.textMuted, fontStyle: 'italic' },
  // 10 张满额提示:静默一行,与 mediaAdd 同字号同色系,但更低调。
  mediaCap: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMutedPale, fontStyle: 'italic' },

  // 已选照片的缩略图:像一排小相片。横向自动换行。
  // 缩略图在底部固定栏内,横向边距由 footer(paddingHorizontal:32)提供,与 ＋Photos / Finish 对齐。
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 2 },
  thumbWrap: { width: 52, height: 52 },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 4, // 微圆角,像相片
    borderWidth: 1,
    borderColor: colors.borderLight, // 暖灰边,像相纸边
    backgroundColor: colors.surfacePhoto,
  },
  // 右上角的小 ✕:单独删这一张。
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.brand, // 品牌主题色
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: { fontFamily: fonts.regular, color: colors.backgroundPaper, fontSize: 10, lineHeight: 12 },
  // Video thumbnail extras: blank placeholder (before the poster frame loads), a small
  // film badge, and a translucent overlay that holds the "compressing" spinner.
  videoThumbBlank: { alignItems: 'center', justifyContent: 'center' },
  // Centered play button (the "this is a video" cue). A soft dark disc so a white
  // triangle stays legible on any poster frame; the triangle nudged right for optical centering.
  videoPlayWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayDisc: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(43,34,26,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayIcon: { marginLeft: 2 },
  videoThumbOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(28, 22, 17, 0.45)', // 暖黑蒙版:百分比在任何画面上都清晰
  },

  // 底单(遮罩 / 圆角 / 抓手 / 滑入+下拉手势)已收进 BottomSheet 组件,这里只留内容样式。
  dateHero: {
    fontFamily: fonts.regular,
    fontSize: 19,
    lineHeight: 25,
    letterSpacing: -0.3,
    color: colors.textHeading,
    textAlign: 'center',
  },
  // 标题下方的浅分割线:满宽、极细,暖浅金。
  dateHeroDivider: { alignSelf: 'stretch', height: 1, backgroundColor: colors.accentGoldSoft },
  // backLink / backLinkText:作为 style / textStyle 覆盖传给 <Button variant="link">
  backLink: { marginTop: -8, paddingVertical: 8, paddingHorizontal: 16 }, // 往上靠,与 words-only 成一组(用户:下方收紧)
  escapeWrap: { marginTop: -6 }, // words-only 往上靠近 Seal 按钮,下方不再松散
  backLinkText: { fontSize: 14, color: colors.textMuted },
  // 在底单里:把 Seal 按钮往日历那边收紧一点(BottomSheet 子项默认 gap 18,这里抵消一截)。
  sealButtonInSheet: { marginTop: 12 }, // 与上方档位框拉开一点距离(用户:按钮往下移)
  // busy 阶段文案:按钮正下方一行安静的小字("Preparing your video… / Confirming your purchase…")。
  busyPhaseText: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMutedLight, textAlign: 'center', marginTop: 8 },
  // 压缩真实进度百分比(缩略图遮罩层里,替代干转的圈)。
  videoPctText: { fontFamily: fonts.regular, fontSize: 12, fontWeight: '600', color: colors.background }, // 奶白字,配深色蒙版

  // ── SealSheet 专属样式 ──
  // 标题:大一点,居中,Courier Prime,深棕。
  sealSheetTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    letterSpacing: -0.4,
    color: colors.textHeading,
    textAlign: 'center',
  },
  // 摘要清单:紧凑列表,每行左对齐。
  sealSheetInventory: { alignSelf: 'stretch', gap: 4 },
  sealSheetItem: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMutedSoft,
  },
  // Returning 行的可点暗号:金色点线下划线(与日历标题/誓言快捷键同一套语言)。
  sealSheetItemTappable: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: colors.accentGold,
  },
  // 清单里的主题色强调(送达日期 / 回信邮箱),嵌套 Text 使用。
  sealSheetItemBrand: { color: colors.brandText },
  // Fine divider: full-width warm gold (slightly deeper than the date-hero one).
  sealSheetDivider: { alignSelf: 'stretch', height: 1, backgroundColor: colors.accentGoldMid },
  // Three-box pricing ladder.
  sealSheetLadder: { flexDirection: 'row', alignSelf: 'stretch', gap: 8 },
  ladderBox: {
    flex: 1,
    minHeight: 132, // 容下多行标题(如 "Photos & Short Video")+ 两行内容 + 价格;一行 cell 自动等高对齐
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,          // inactive border — palette.borderMid (#C9B097)
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    gap: 3,
  },
  // 按下反馈:边框亮成主题色(与 mediaBtnPressed 同一语言)。
  ladderBoxPressed: { borderColor: colors.brand },
  ladderBoxActive: {
    // 选中 = 仅用更粗的深棕边框区分,不加填充(用户:填充色都不要)。
    borderWidth: 1.5,
    borderColor: colors.brandDark,
  },
  ladderLabel: {
    fontFamily: fonts.bold,
    fontSize: 13,
    letterSpacing: -0.3,
    color: colors.textHeading,
  },
  ladderLabelActive: { color: colors.brandDark },
  ladderLine: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMutedSoft,         // inactive muted line — palette.mutedSoft (#6B5A4B)
  },
  ladderLineActive: { color: colors.textBody },
  ladderPrice: {
    fontFamily: fonts.bold,
    fontSize: 13,
    marginTop: 'auto' as unknown as number,
    color: colors.textHeading,
  },
  ladderPriceActive: { color: colors.brandDark },
  // "Your first capsule is on us." — shown only when isFree.
  sealSheetReason: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    alignSelf: 'stretch',
  },
  // 「Seal as words only · Free」:静默链接样式。A10: paddingVertical 放大到 10 以达到 ~44pt 触摸区。
  sealSheetEscape: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    textDecorationLine: 'underline',
    paddingVertical: 10,
  },
  // Wraps the title line + tier boxes as one unit so the sheet's gap:18 doesn't
  // separate them; the small marginBottom on oneTimeNote is the only inner gap.
  pricingGroup: { alignSelf: 'stretch' },
  // Small left-aligned heading for the pricing group; sits close above the tier boxes.
  oneTimeNote: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 19,
    color: colors.textBody,
    alignSelf: 'stretch',
    textAlign: 'left',
    marginBottom: spacing.lg, // 与下方价格框的呼吸感(8→16,间距 token)
  },
  // Add-more row (has media), left-aligned to match the thumbnails above it.
  sealMediaRow: { flexDirection: 'row', justifyContent: 'flex-start', gap: 22, marginTop: 10, alignSelf: 'stretch' },
  // Left-align the seal-sheet thumbnail strip (the sheet centres its children by default).
  thumbsSeal: { alignSelf: 'stretch' },
  // Ghost add-media button (icon + label, no border/fill) — same icons as the empty-state well.
  mediaGhostBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44 },
  mediaGhostLabel: { fontFamily: fonts.regular, fontSize: 14, letterSpacing: 0.3, color: colors.brandDark },
  mediaGhostOn: { color: colors.brandText },
  // Gentle "can't switch to this tier" notice: faint warm-orange wash + accent bar, left-aligned.
  tierNotice: {
    alignSelf: 'stretch',
    backgroundColor: '#F3D6B4',        // warm peach wash — a touch more saturated so it reads as a real notice
    borderLeftWidth: 3,
    borderLeftColor: '#C2703A',        // warm terracotta accent
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  tierNoticeText: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.textBody, textAlign: 'left' },
  // "Add a moment" well (empty paid tier): a hairline paper well — no shadow, no material card.
  mediaWell: {
    alignSelf: 'stretch',
    backgroundColor: colors.surfaceChip, // 与日期快捷片统一底色(#FAE6C9,token 化)
    borderRadius: 10,
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  wellHint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.textMutedSoft, textAlign: 'left', marginBottom: 13 },
  wellButtons: { flexDirection: 'row', gap: 14, alignSelf: 'stretch' },
  // Quiet outline button (line icon + label), no fill, no shadow.
  mediaBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 40, // 压扁一档(48→40;触区仍够,外层有 padding)
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4, // 圆角收小(8→4),更贴近直角的品牌语言
    paddingHorizontal: 10,
  },
  // 按下反馈:边框亮成主题色(手指落下的那一瞬有回应)。
  mediaBtnPressed: { borderColor: colors.brand },
  mediaBtnLabel: { fontFamily: fonts.regular, fontSize: 13, letterSpacing: 0.5, color: colors.brandDark },
  // Whisper-quiet fallback to the free words-only path.
  wellFreeWrap: { alignSelf: 'center', marginTop: 12 },
  wellFree: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMutedSoft, textAlign: 'center' },

  // 封存后那一屏:内容居中 + 按钮沉底(对齐设计图)。
  sealedScreen: {
    flex: 1,
    backgroundColor: colors.background, // 与首页一致的干净奶油底
  },
  // 信封 + 标题 + 描述:占满按钮以上的空间并居中;底部留白把整组上移一些(对齐设计图)。
  sealedContent: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 160 },
  // 底部按钮容器:略离底部(上移一些),按钮在内居中。
  sealedFooter: { paddingHorizontal: 32, paddingBottom: 40, alignItems: 'center' },
  // 这一屏的按钮更窄更精致:不再满宽,居中并限定最大宽度。
  sealedButton: { alignSelf: 'center', width: '100%', maxWidth: 296 },
  sealedLogo: {
    width: 120,
    height: 79, // 蜡封信封图标(aspect 50/33)
    marginBottom: spacing.xl, // 与下方标题拉开呼吸感
    shadowColor: palette.brownWarm, // 暖棕投影,与米色底和谐(不是脏黑)
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  // 标题:Courier Prime 粗体,深棕,收紧字距(用户规格)。
  sealedText: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.brandDark,
    letterSpacing: -0.9,
    marginTop: 4,
  },
  // 描述:Courier Prime 常规,居中,行高 20(用户规格)。B: 换用 brandText(#84410F),达到 ≥4.5:1(AA)
  sealedHint: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.brandText, // B: 文字场景用 brandText 而非 brand,确保对比度 AA
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
