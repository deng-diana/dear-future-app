// 封存流程:write → date → seal → Edge Function(服务器端校验 + 写库)。
// 付款验证由 supabase/functions/seal-letter/index.ts 在服务器端完成——
// 客户端只传购买凭证 ID,服务器向 RevenueCat 确认后才落库。

import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, findNodeHandle, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AccountButton from '@/components/AccountButton';
import BottomSheet from '@/components/BottomSheet';
import Button from '@/components/Button';
import Calendar from '@/components/Calendar';
import Dateline from '@/components/Dateline';
import SealCeremony from '@/components/SealCeremony';
import SignIn from '@/components/SignIn';
import Splash from '@/components/Splash';
import { DEMO_MODE, MIN_SEAL_DAYS } from '@/constants/rules';
import { colors, fonts } from '@/theme';
import { pickPhotos, pickVideo, randomFolder, uploadMedia, MAX_PHOTOS, type PickedMedia } from '@/lib/media';
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

// 两个日期之间相差多少天(按"整天",不管时分秒)。
function daysBetween(a: Date, b: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((b.getTime() - a.getTime()) / msPerDay);
}

// Pricing ladder shown in the SealSheet — three static info boxes (not tappable).
// These are informational only; the Seal button + "Seal as words only" link do the acting.
const LADDER = [
  { key: 'words',  label: 'Words',   lines: ['text'] },
  { key: 'photos', label: 'Photos',  lines: ['+4 photos', ':30 video'] },
  { key: 'video',  label: 'Photos+', lines: ['+10 photos', '5m video'] },
] as const;

export default function WriteScreen() {
  const [letter, setLetter] = useState('Dear future me,\n\n'); // 信里写了什么(开屏即预填称呼,可编辑)
  const [sealing, setSealing] = useState(false); // 正在播封存仪式动画?
  const [sealed, setSealed] = useState(false); // 封存了没?

  // 可选附件:最多 10 张照片 + 1 段视频(封存时一起上传)。
  const [photos, setPhotos] = useState<PickedMedia[]>([]);
  const [video, setVideo] = useState<PickedMedia | null>(null);
  const [busy, setBusy] = useState(false); // 正在上传媒体 + 写库(按 Seal 后那一下)

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

  // 最早可选的送达日 = 今天(归零到 00:00)+ 15 天。
  // 用 useMemo 按"今天是哪天"缓存:同一天内复用同一个对象(不每次按键都重算),
  // 跨过午夜后 todayStamp 变化才重算 —— 既省分配,又不会让 15 天下限悄悄缩成 14 天。
  const todayStamp = startOfDay(new Date()).getTime();
  const earliest = useMemo(() => addDays(new Date(todayStamp), MIN_SEAL_DAYS), [todayStamp]);

  // 用户选的送达日;还没选时为 null,跟着 earliest 走。
  const [deliverOn, setDeliverOn] = useState<Date | null>(null);
  // 真正生效的日期:没选过就用 earliest;选过、但因跨午夜早于了 earliest,也夹回 earliest。
  const effectiveDate = deliverOn && deliverOn.getTime() >= earliest.getTime() ? deliverOn : earliest;

  // 日期已被 earliest + 选择器 minimumDate 夹在合法范围内,所以只剩"信不能为空"这一道闸。
  // 只有"称呼"还不算写了信 —— 要等用户在称呼之外真的写了字,底部才出现。
  const canSeal = letter.trim().length > 0 && letter.trim() !== 'Dear future me,';

  // 视频时长(秒),没有视频就是 0。
  const videoSeconds = video?.durationSec ?? 0;

  // 根据当前草稿内容计算定价档位(纯计算,实时响应)。
  const horizonDays = daysBetween(startOfDay(new Date(todayStamp)), effectiveDate);
  const tierResult = useMemo(
    () =>
      tierFor({
        photoCount: photos.length,
        videoSeconds,
        horizonDays,
        // TODO: server-authoritative freeSealUsed — v1 固定传 false,
        // 等 Edge Function 接好后改从服务器读取。
        freeSealUsed: false,
      }),
    [photos.length, videoSeconds, horizonDays],
  );

  // 去掉媒体后的"纯文字"档位(用于判断要不要显示"Seal as words only"选项)。
  const wordsOnlyTier = useMemo(
    () =>
      tierFor({
        photoCount: 0,
        videoSeconds: 0,
        horizonDays,
        freeSealUsed: false,
      }),
    [horizonDays],
  );
  // 只有当前有媒体(有更贵的档位)时,才显示"Seal as words only"备选。
  const showWordsOnlyEscape = (photos.length > 0 || video !== null) && !tierResult.isFree;

  // ── 核心封存逻辑 ──
  // 顺序:先上传媒体(如有)→ 再调 seal-letter Edge Function(服务器端验证 + 写库)。
  // Edge Function 负责:身份验证、输入校验、免费次数检查、RevenueCat 购买验证、
  // 防重放攻击、最终写库。客户端只做"上传媒体 + 调函数"两件事。
  //
  // 参数:
  //   sealTier       — 档位('words'|'photos'|'video'|null),null = 免费
  //   transactionId  — 购买凭证 ID(付款档位必须传,免费时 undefined)
  //   overridePhotos / overrideVideo — 用于"仅文字"备选路径(绕过当前媒体 state)
  async function doSeal(
    sealTier: 'words' | 'photos' | 'video' | null,
    transactionId: string | undefined,
    overridePhotos?: PickedMedia[],
    overrideVideo?: PickedMedia | null,
  ) {
    const effectivePhotos = overridePhotos ?? photos;
    const effectiveVideo = overrideVideo !== undefined ? overrideVideo : video;

    setBusy(true); // 上传 + 封存期间,按钮转圈、防重复点

    // ── 第一步:上传媒体(如有) ──
    // 先把照片 / 视频传到 memories 桶(同一个随机文件夹),拿到公开 URL。
    const folder = randomFolder();
    const photoUrls: string[] = [];
    for (let i = 0; i < effectivePhotos.length; i++) {
      const u = await uploadMedia(effectivePhotos[i], folder, i);
      // 上传失败 → 千万别封存。封存即消失,信一走用户永远发现不了图丢了。
      if (!u) {
        setBusy(false);
        Alert.alert('Upload failed', "Your photos or video didn't upload. Please check your connection and try again.");
        return; // 信还在、可重试
      }
      photoUrls.push(u);
    }
    let videoUrl: string | null = null;
    if (effectiveVideo) {
      videoUrl = await uploadMedia(effectiveVideo, folder, 0);
      if (!videoUrl) {
        setBusy(false);
        Alert.alert('Upload failed', "Your photos or video didn't upload. Please check your connection and try again.");
        return; // 信还在、可重试
      }
    }

    // ── 第二步:调 seal-letter Edge Function ──
    // 服务器端函数会:验证 JWT 身份、校验输入、验证购买、防重放、写库。
    // 客户端不再直接往 letters 表 insert。
    const { error } = await supabase.functions.invoke('seal-letter', {
      body: {
        body: letter.trim(),
        deliver_on: toISODate(effectiveDate),
        // 多张照片存成 JSON 数组字符串(没有就传 null);单段视频传 URL。
        photo_url: photoUrls.length ? JSON.stringify(photoUrls) : null,
        video_url: videoUrl,
        tier: sealTier,       // null = 免费;'words'/'photos'/'video' = 付款档位
        transactionId,        // 付款时从 purchaseTier() 拿到的商店交易 ID
      },
    });

    setBusy(false);
    if (error) {
      // error.message 是 Edge Function 返回的 JSON 里的 error 字段或 HTTP 错误。
      // 先尝试解析是否是"免费次数已用完"这个特殊情况。
      let msg: string = error.message ?? 'Something went wrong. Please try again.';
      try {
        // supabase.functions.invoke 把响应体序列化成 error.message 字符串;
        // 如果 Edge Function 返回 JSON { error: 'free_seal_already_used', message: '...' },
        // 我们要解析出 message 字段展示给用户。
        const parsed = JSON.parse(msg) as { error?: string; message?: string };
        if (parsed.error === 'free_seal_already_used') {
          msg = parsed.message ?? 'Your free seal has already been used. Please choose a paid tier.';
        } else if (parsed.message) {
          msg = parsed.message;
        } else if (parsed.error) {
          msg = parsed.error;
        }
      } catch {
        // msg 本身就是普通字符串,直接用
      }
      console.log('封存失败:', msg);
      Alert.alert('Could not seal', msg, [{ text: 'OK' }]);
      return; // 没写成功就不切到"已封存"屏,信还在,可重试
    }

    if (DEMO_MODE) {
      // 演示模式:封存后立刻触发送达云函数 → 几秒内邮箱就收到这封信。
      // fire-and-forget:不阻塞封存动画,后台把信发出去。
      supabase.functions.invoke('deliver').catch(() => {});
    }
    setSealing(true); // 写库成功 → 先播封存仪式动画,动画结束再切"已封存"屏
  }

  // 按「完成写信」:正在忙就忽略;信不能为空;然后进入"选日期"那一屏(这里不问登录)。
  function handleFinish() {
    if (busy) return;
    if (!letter.trim()) return;
    Keyboard.dismiss(); // 先收键盘,免得它和弹层抢空间
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
  async function handleSealSheet() {
    if (busy) return;

    if (tierResult.isFree) {
      // 免费:直接封存,tier = null,不需要 transactionId。
      await doSeal(null, undefined);
      return;
    }

    // DEMO FALLBACK:购买功能在 web / 无密钥时被禁用。
    // 为了让 /app 演示页和 Expo Go 体验能正常封存,遇到 'purchases disabled' 就跳过付款,
    // 用 null tier(免费路径)调 seal-letter。服务器会按免费规则校验。
    // 真实 App Store 构建有密钥时不会走这条路。
    if (Platform.OS === 'web') {
      // web 演示:跳过付款,tier = null(免费路径)。
      await doSeal(null, undefined);
      return;
    }

    // 原生:先触发购买弹窗,再把凭证传给服务器验证。
    // 顺序:上传媒体(在 doSeal 里)→ 购买弹窗(这里)→ 服务器验证 + 写库(在 doSeal 里)。
    const tier = tierResult.tier!;
    const result = await purchaseTier(tier);

    if (result.ok) {
      // 付款成功 → 封存,把商店交易 ID 一起送给服务器验证。
      // result.transactionId = App Store / Google Play 返回的原始交易 ID。
      await doSeal(tier, result.transactionId);
    } else if (result.cancelled) {
      // 用户取消付款 → 留在底单,什么都不做。
      return;
    } else if (result.error === 'purchases disabled') {
      // Demo fallback:购买模块未启用(无密钥的测试构建)→ 免费路径封存。
      // Demo fallback — real App Store builds have purchases enabled.
      await doSeal(null, undefined);
    } else {
      // 其他错误(网络失败、App Store 异常等) → 温和提示,留在底单。
      Alert.alert(
        'Something went wrong',
        result.error ?? 'The purchase could not be completed. Please try again.',
        [{ text: 'OK' }],
      );
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
      'Seal with words only?',
      `The Words tier holds text only, so ${mediaDesc} can't travel in this capsule. ` +
        "They stay safe in your phone's library — nothing is deleted from your device. " +
        'Only your words will be sealed.',
      [
        { text: 'Keep writing', style: 'cancel' },
        {
          text: 'Seal words only',
          // Not style:'destructive' — this is a confirmation, not a dangerous action.
          onPress: async () => {
            // 确定用纯文字档位(wordsOnlyTier.tier 可能是 null 或 'words')。
            // 用空媒体调 doSeal(覆盖当前 state,因为 setState 是异步的,doSeal 若直接读 state 会拿到旧值)。
            if (wordsOnlyTier.isFree) {
              // 纯文字 + 免费条件满足 → 免费封存。
              await doSeal(null, undefined, [], null);
            } else {
              // 纯文字但需要付款(例如时间跨度 > 365 天) → 先购买再封存。
              const result = await purchaseTier('words');
              if (result.ok) {
                await doSeal('words', result.transactionId, [], null);
              } else if (result.cancelled) {
                return; // 取消 → 留在底单
              } else if (result.error === 'purchases disabled') {
                await doSeal(null, undefined, [], null); // web demo fallback
              } else {
                Alert.alert('Something went wrong', result.error ?? 'The purchase could not be completed.', [{ text: 'OK' }]);
              }
            }
            // 只清草稿里的媒体引用(不碰相册里的文件)。
            setPhotos([]);
            setVideo(null);
          },
        },
      ],
    );
  }

  // 选照片(可多选,最多补到 10 张)/ 1 段视频(从相册)。
  async function addPhotos() {
    const picked = await pickPhotos(MAX_PHOTOS - photos.length);
    if (picked.length) setPhotos((prev) => [...prev, ...picked].slice(0, MAX_PHOTOS));
  }
  async function addVideo() {
    const m = await pickVideo();
    if (m) setVideo(m);
  }

  // 封存之后想再写一封:清空内容 + 清掉附件,回到全新写信屏(但仍保持登录)。
  function writeAnother() {
    setLetter('Dear future me,\n\n');
    setDeliverOn(null);
    setSealed(false);
    setPhotos([]);
    setVideo(null);
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
        {/* 内容居中:信封 + 标题 + 描述(信封改小一些)。 */}
        <View style={styles.sealedContent}>
          {/* A7: 装饰性信封图片,对屏幕阅读器隐藏 */}
          <Image source={require('@/assets/images/sealed-envelope.png')} style={styles.sealedLogo} resizeMode="contain" accessible={false} importantForAccessibility="no-hide-descendants" />
          {/* A2: accessibilityLiveRegion="assertive" 确保 Android TalkBack 也能立即播报;ref 用于 iOS VoiceOver 焦点 */}
          <Text ref={sealedHeadingRef} style={styles.sealedText} accessibilityLiveRegion="assertive">Sealed</Text>
          <Text style={styles.sealedHint}>It will find its way back to you — on a day you've long forgotten.</Text>
        </View>

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
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      {/* 干净纯色底(#FAE6C9)—— 去掉纸张质感 + 呼吸层(用户要求)。 */}
      <View style={styles.flex}>
        {/*
          已登录时:头像行放在最顶部(普通 flex 流,非绝对定位)。
          SafeAreaView 的 padding-top 已被证明能正确推开刘海,头像行自然落在刘海下方。
        */}
        {session ? <AccountButton email={session.user.email!} onSignOut={confirmSignOut} /> : null}

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          {/* 可滚动的信纸:邮戳 + 分割线 + 正文一起滚动。写得越多,邮戳越往上退,腾出更大的写信区(用户要求:日期不必一直钉在顶部)。 */}
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}>
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

            {/* 已选的照片:一排小"相片",随信一起滚动。每张右上角一个 ✕ 单独删。 */}
            {canSeal && photos.length ? (
              <View style={styles.thumbs}>
                {photos.map((p, idx) => (
                  <View key={p.uri + idx} style={styles.thumbWrap}>
                    <Image source={{ uri: p.uri }} style={styles.thumb} />
                    {/* A8: hitSlop 扩到 14pt,加上 accessibilityLabel 让屏幕阅读器播报"Remove photo" */}
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
              </View>
            ) : null}
          </ScrollView>

          {/* 底部固定栏:附件按钮 + Finish。固定在键盘上方,绝不被键盘遮住(用户要求)。
              还没写字时整条隐藏 —— 守"一张干净的纸"。 */}
          {canSeal ? (
            <View style={styles.footer}>
              {/* 可选附件:照片(可多选,最多 10 张)+ 1 段视频。安静一行,守"写信为主"。 */}
              {/* A9: 媒体按钮加上 hitSlop 和 accessibilityLabel */}
              <View style={styles.mediaRow}>
                {/* 未满 10 张:显示 ＋ Photos;满 10 张:显示安静提示文字(不显示按钮)。 */}
                {photos.length < MAX_PHOTOS ? (
                  <Pressable onPress={addPhotos} disabled={busy} accessibilityRole="button" hitSlop={{ top: 14, bottom: 14 }} accessibilityLabel="Add photos">
                    <Text style={styles.mediaAdd}>＋ Photos</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.mediaCap}>That's all 10 — a full capsule.</Text>
                )}
                {video ? (
                  <Pressable onPress={() => setVideo(null)} disabled={busy} accessibilityRole="button" hitSlop={{ top: 14, bottom: 14 }} accessibilityLabel="Remove video">
                    <Text style={styles.mediaOn}>🎬  ✕</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={addVideo} disabled={busy} accessibilityRole="button" hitSlop={{ top: 14, bottom: 14 }} accessibilityLabel="Add a video">
                    <Text style={styles.mediaAdd}>＋ Video</Text>
                  </Pressable>
                )}
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
      <BottomSheet visible={step === 'date'} onClose={() => setStep('write')}>
        <Text style={styles.dateHero}>When should it come home?</Text>

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

        {/* 想再改改信 → 关底单回到写信屏(草稿与附件都还在)。 */}
        <Button
          variant="link"
          label="← Keep writing"
          onPress={() => setStep('write')}
          disabled={busy}
          style={styles.backLink}
          textStyle={styles.backLinkText}
        />
      </BottomSheet>

      {/*
        ── SealSheet:付款 + 确认底单 ──
        step==='seal' 时从底部升起。展示:信件摘要 + 定价档位 + Seal 按钮 + 纯文字备选 + 返回。
        关闭路径:点遮罩 / 下拉 / ← Keep writing —— 都不封存,草稿 + 附件完整保留。
      */}
      <BottomSheet visible={step === 'seal'} onClose={() => setStep('date')}>
        {/* 标题 */}
        <Text style={styles.sealSheetTitle}>Seal this capsule</Text>

        {/* 信件摘要清单:只显示非零项。 */}
        <View style={styles.sealSheetInventory}>
          {/* 文字 —— 永远有 */}
          <Text style={styles.sealSheetItem}>Your words</Text>
          {/* 照片:1 张 or n 张 */}
          {photos.length === 1 && <Text style={styles.sealSheetItem}>1 photo</Text>}
          {photos.length > 1 && <Text style={styles.sealSheetItem}>{photos.length} photos</Text>}
          {/* 视频:格式化成 m:ss */}
          {video !== null && (
            <Text style={styles.sealSheetItem}>
              a {formatDuration(videoSeconds > 0 ? videoSeconds : 0)} video
            </Text>
          )}
          {/* 送达日 */}
          <Text style={styles.sealSheetItem}>Returning {formatDate(effectiveDate)}</Text>
        </View>

        {/* 分割线:细金 */}
        <View style={styles.sealSheetDivider} />

        {/* Three-box pricing ladder — purely informational, not tappable. */}
        {/* Active box = the tier this capsule currently falls into. */}
        {(() => {
          const activeTierKey = tierResult.tier ?? 'words';
          // Free first-capsule: activeTierKey stays 'words' but priceHint is 'Free'.
          const priceForSlot = (key: 'words' | 'photos' | 'video') =>
            key === activeTierKey ? tierResult.priceHint : TIERS[key].priceHint;
          return (
            <View style={styles.sealSheetLadder}>
              {LADDER.map(({ key, label, lines }) => {
                const active = key === activeTierKey;
                const price = priceForSlot(key);
                return (
                  <View
                    key={key}
                    style={[styles.ladderBox, active && styles.ladderBoxActive]}
                    accessibilityRole="text"
                    accessibilityLabel={`${TIERS[key].label}, ${price}, ${TIERS[key].description}${active ? '. This is your capsule.' : ''}`}>
                    <Text numberOfLines={1} style={[styles.ladderLabel, active && styles.ladderLabelActive]}>{label}</Text>
                    {lines.map((l) => (
                      <Text key={l} numberOfLines={1} style={[styles.ladderLine, active && styles.ladderLineActive]}>{l}</Text>
                    ))}
                    <Text numberOfLines={1} style={[styles.ladderPrice, active && styles.ladderPriceActive]}>{price}</Text>
                  </View>
                );
              })}
            </View>
          );
        })()}
        {/* Show the warm "first capsule is on us" line only when the seal is free. */}
        {/* For paid tiers, the three boxes already convey the info. */}
        {tierResult.isFree ? (
          <Text style={styles.sealSheetReason}>{tierResult.reason}</Text>
        ) : null}

        {/* 主按钮:Seal · $X.XX 或 Seal · Free */}
        <Button
          label={`Seal · ${tierResult.priceHint}`}
          onPress={handleSealSheet}
          loading={busy}
          style={styles.sealButtonInSheet}
        />

        {/* 次选:只有有媒体(更贵档位)时才显示 —— 去掉媒体改用纯文字封存。
            A10: 加上 hitSlop + paddingVertical 让触摸区至少达到 ~44pt */}
        {showWordsOnlyEscape ? (
          <Pressable onPress={handleWordsOnly} disabled={busy} accessibilityRole="button" hitSlop={{ top: 12, bottom: 12 }}>
            <Text style={styles.sealSheetEscape}>
              Seal as words only · {wordsOnlyTier.priceHint}
            </Text>
          </Pressable>
        ) : null}

        {/* 返回继续写(关底单,草稿 + 附件都在)。 */}
        <Button
          variant="link"
          label="← Keep writing"
          onPress={() => setStep('date')}
          disabled={busy}
          style={styles.backLink}
          textStyle={styles.backLinkText}
        />
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.background }, // 干净纯色底(用户指定)

  // 顶部邮戳与信之间的分割线:两段细金线 + 中间金色星,与正文同样 32 页边距。
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 32, marginTop: 12, marginBottom: 12, gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.accentGold },
  dividerStar: { color: colors.accentGold, fontSize: 13, marginTop: -2 },

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

  footer: { paddingHorizontal: 32, paddingVertical: 20, gap: 14 },
  mediaRow: { flexDirection: 'row', gap: 22, paddingBottom: 2 },
  mediaAdd: { fontSize: 14, color: colors.textMuted }, // 未选:暖灰
  mediaOn: { fontSize: 14, color: colors.brandText }, // B: 已选 — 换用 brandText(#84410F),达到 ≥4.5:1(AA)
  // 10 张满额提示:静默一行,与 mediaAdd 同字号同色系,但更低调。
  mediaCap: { fontSize: 14, color: colors.textMutedPale, fontStyle: 'italic' },

  // 已选照片的缩略图:像一排小相片。横向自动换行。
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
  thumbRemoveText: { color: colors.backgroundPaper, fontSize: 10, lineHeight: 12 },

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
  backLink: { marginTop: 4, paddingVertical: 8, paddingHorizontal: 16 },
  backLinkText: { fontSize: 14, color: colors.textMuted },
  // 在底单里:把 Seal 按钮往日历那边收紧一点(BottomSheet 子项默认 gap 18,这里抵消一截)。
  sealButtonInSheet: { marginTop: -8 },

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
  // Fine divider: full-width warm gold (slightly deeper than the date-hero one).
  sealSheetDivider: { alignSelf: 'stretch', height: 1, backgroundColor: colors.accentGoldMid },
  // Three-box pricing ladder.
  sealSheetLadder: { flexDirection: 'row', alignSelf: 'stretch', gap: 8 },
  ladderBox: {
    flex: 1,
    minHeight: 96,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,          // inactive border — palette.borderMid (#C9B097)
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    gap: 3,
  },
  ladderBoxActive: {
    borderWidth: 1.5,
    borderColor: colors.brandDark,
    backgroundColor: colors.surfacePhoto,
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
  sealedLogo: { width: 120, height: 79 }, // 蜡封信封图标(改小,aspect 50/33)
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
