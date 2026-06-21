import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AccountButton from '@/components/AccountButton';
import BottomSheet from '@/components/BottomSheet';
import Calendar from '@/components/Calendar';
import Dateline from '@/components/Dateline';
import SealCeremony from '@/components/SealCeremony';
import SignIn from '@/components/SignIn';
import { DEMO_MODE, MIN_SEAL_DAYS } from '@/constants/rules';
import { pickPhotos, pickVideo, randomFolder, uploadMedia, MAX_PHOTOS, type PickedMedia } from '@/lib/media';
import { supabase } from '@/lib/supabase';

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

export default function WriteScreen() {
  const [letter, setLetter] = useState('Dear future me,\n\n'); // 信里写了什么(开屏即预填称呼,可编辑)
  const [sealing, setSealing] = useState(false); // 正在播封存仪式动画?
  const [sealed, setSealed] = useState(false); // 封存了没?

  // 可选附件:最多 4 张照片 + 1 段短视频(封存时一起上传)。
  const [photos, setPhotos] = useState<PickedMedia[]>([]);
  const [video, setVideo] = useState<PickedMedia | null>(null);
  const [busy, setBusy] = useState(false); // 正在上传媒体 + 写库(按 Seal 后那一下)

  // 写信流程的两步:'write' = 写信 + 选附件;'date' = 安静地只选送达日 + 封存。
  const [step, setStep] = useState<'write' | 'date'>('write');
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

  // 真正把信写进 Supabase 的 letters 表。
  // 只送"信的内容 + 送达日";主人(owner_id)由数据库按当前登录的人自动填。
  async function doSeal() {
    setBusy(true); // 上传 + 写库期间,按钮转圈、防重复点
    // 先把照片 / 视频传到 memories 桶(同一个随机文件夹),拿到公开 URL。
    const folder = randomFolder();
    // 多张照片:逐张上传,带 index(文件名用得上);任一张失败就整体中止。
    const photoUrls: string[] = [];
    for (let i = 0; i < photos.length; i++) {
      const u = await uploadMedia(photos[i], folder, i);
      // 上传失败 → 千万别封存。封存即消失,信一走用户永远发现不了图丢了。
      if (!u) {
        setBusy(false);
        Alert.alert('Upload failed', "Your photos or video didn't upload. Please check your connection and try again.");
        return; // 信还在、可重试
      }
      photoUrls.push(u);
    }
    // 可选视频:单段;视频忽略 index。
    let videoUrl: string | null = null;
    if (video) {
      videoUrl = await uploadMedia(video, folder, 0);
      if (!videoUrl) {
        setBusy(false);
        Alert.alert('Upload failed', "Your photos or video didn't upload. Please check your connection and try again.");
        return; // 信还在、可重试
      }
    }
    const { error } = await supabase.from('letters').insert({
      body: letter.trim(),
      deliver_on: toISODate(effectiveDate),
      // 多张照片存成 JSON 数组字符串(没有就存 null);单段视频存它的 URL。
      photo_url: photoUrls.length ? JSON.stringify(photoUrls) : null,
      video_url: videoUrl,
    });
    setBusy(false);
    if (error) {
      console.log('封存失败:', error.message);
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

  // 按「封存」:正在忙就忽略;没登录就先弹登录;已登录就直接封。
  function handleSeal() {
    if (busy) return;
    if (!session) {
      setShowSignIn(true);
      return;
    }
    doSeal();
  }

  // 选照片(可多选,最多补到 4 张)/ 1 段视频(从相册)。
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

  // 岔路口⓪:正在登录 → 显示登录界面(输邮箱 → 收码 → 验证)。
  if (showSignIn) {
    return (
      <SignIn
        onCancel={() => setShowSignIn(false)}
        onVerified={() => {
          setShowSignIn(false);
          // 验证刚通过,登录信息已就位,直接封存(主人由数据库自动填)。
          doSeal();
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
          <Image source={require('@/assets/images/sealed-envelope.png')} style={styles.sealedLogo} resizeMode="contain" />
          <Text style={styles.sealedText}>Sealed</Text>
          <Text style={styles.sealedHint}>It will find its way back to you — on a day you've long forgotten.</Text>
        </View>

        {/* 底部按钮:与写信页 Seal 按钮同款(实心主题色、直角、近白文字),但更窄更精致。 */}
        <View style={styles.sealedFooter}>
          <Pressable onPress={writeAnother} style={[styles.sealButton, styles.sealedButton]} accessibilityRole="button">
            <Text style={styles.sealButtonText}>Write another letter</Text>
          </Pressable>
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
          {/* 顶部邮戳:日期 / 可编辑城市 / 时间(此刻的你)。 */}
          <Dateline />

          {/* 顶部邮戳与信之间的分割线:两段细金线 + 中间金色星(代码画,稳定渲染)。 */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerStar}>✦</Text>
            <View style={styles.dividerLine} />
          </View>

        {/* 整封信(含称呼)都在这一个输入框里写,同一字体同一字号;光标是暖金棕色。 */}
        <TextInput
          style={styles.input}
          value={letter}
          onChangeText={setLetter}
          multiline
          autoFocus
          textAlignVertical="top"
          selectionColor="#C68A3A"
          cursorColor="#C68A3A"
        />

        {/* 还没写字时,底部完全隐藏 —— 守"一张干净的纸"。一旦动笔,附件 + Finish 才出现。 */}
        {canSeal ? (
          <View style={styles.footer}>
            {/* 已选的照片:一排小"相片",每张右上角一个 ✕ 单独删。 */}
            {photos.length ? (
              <View style={styles.thumbs}>
                {photos.map((p, idx) => (
                  <View key={p.uri + idx} style={styles.thumbWrap}>
                    <Image source={{ uri: p.uri }} style={styles.thumb} />
                    <Pressable
                      onPress={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                      disabled={busy}
                      hitSlop={8}
                      style={styles.thumbRemove}
                      accessibilityRole="button">
                      <Text style={styles.thumbRemoveText}>✕</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}

            {/* 可选附件:照片(可多选,最多 4 张)+ 1 段视频。安静一行,守"写信为主"。 */}
            <View style={styles.mediaRow}>
              {photos.length < MAX_PHOTOS ? (
                <Pressable onPress={addPhotos} disabled={busy} accessibilityRole="button">
                  <Text style={styles.mediaAdd}>＋ Photos</Text>
                </Pressable>
              ) : null}
              {video ? (
                <Pressable onPress={() => setVideo(null)} disabled={busy} accessibilityRole="button">
                  <Text style={styles.mediaOn}>🎬  ✕</Text>
                </Pressable>
              ) : (
                <Pressable onPress={addVideo} disabled={busy} accessibilityRole="button">
                  <Text style={styles.mediaAdd}>＋ Video</Text>
                </Pressable>
              )}
            </View>

            {/* 写完了 → 进入选日期那一屏(这里不封存、不问登录)。 */}
            <Pressable
              style={styles.sealButton}
              onPress={handleFinish}
              accessibilityRole="button">
              <Text style={styles.sealButtonText}>Finish</Text>
            </Pressable>
          </View>
        ) : null}
        </KeyboardAvoidingView>
      </View>

      {/*
        选送达日:从底部滑上来的纸张底单(BottomSheet)。可点遮罩、也可下拉关闭。
        关闭 = 回去继续写(step → 'write');底单内部不会误关。
      */}
      <BottomSheet visible={step === 'date'} onClose={() => setStep('write')}>
        <Text style={styles.dateHero}>When should this letter return to you?</Text>

        {/* 标题下方一根浅浅的分割线(#EFDFC0),把标题和日历轻轻分开。 */}
        <View style={styles.dateHeroDivider} />

        {/* 自制 Courier Prime 月历:没选中前空着,选一天 → 归零存进 deliverOn。 */}
        <Calendar key={pickerKey} value={deliverOn} minDate={earliest} onChange={(d) => setDeliverOn(startOfDay(d))} />

        {/* 选了日子才点得动 Seal —— 空月历 + 灰按钮自然引导用户先点一天。 */}
        <Pressable
          style={[styles.sealButton, styles.sealButtonInSheet, (!deliverOn || busy) && styles.sealButtonDisabled]}
          onPress={handleSeal}
          disabled={!deliverOn || busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: !deliverOn || busy }}>
          {busy ? <ActivityIndicator color="#FBEFDB" /> : <Text style={styles.sealButtonText}>Seal</Text>}
        </Pressable>

        {/* 想再改改信 → 关底单回到写信屏(草稿与附件都还在)。 */}
        <Pressable onPress={() => setStep('write')} disabled={busy} style={styles.backLink} accessibilityRole="button">
          <Text style={styles.backLinkText}>← Keep writing</Text>
        </Pressable>
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: '#FAE6C9' }, // 干净纯色底(用户指定)

  // 顶部邮戳与信之间的分割线:两段细金线 + 中间金色星,与正文同样 32 页边距。
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 32, marginTop: 12, marginBottom: 12, gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E0A93E' },
  dividerStar: { color: '#E0A93E', fontSize: 13, marginTop: -2 },

  // 整封信:打字机字体 Courier Prime,暖色墨。称呼是这封信的第一行,同字体同字号。
  // paddingTop 让第一行("Dear future me,")落在邮戳下方、原先题头开始的位置,留出干净的留白。
  input: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 0, // 上间距交给分割线(marginBottom 12),让分割线上下对称
    paddingBottom: 24,
    fontFamily: 'CourierPrime_400Regular',
    fontSize: 16, // 正文字号恢复到 16(用户)
    lineHeight: 23, // 行/段落间距收紧(原 26);光标高度跟随行高
    letterSpacing: -0.5, // 等宽字体唯一能收紧"词间距"的办法:整体微微收紧(字母几乎不变)
    color: '#67350F',
  },

  footer: { paddingHorizontal: 32, paddingVertical: 20, gap: 14 },
  mediaRow: { flexDirection: 'row', gap: 22, paddingBottom: 2 },
  mediaAdd: { fontSize: 14, color: '#9A7E5C' }, // 未选:暖灰
  mediaOn: { fontSize: 14, color: '#B26B24' }, // 已选:波尔多红(✕ 可移除)

  // 已选照片的缩略图:像一排小相片。横向自动换行。
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 2 },
  thumbWrap: { width: 52, height: 52 },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 4, // 微圆角,像相片
    borderWidth: 1,
    borderColor: '#D6C7B2', // 暖灰边,像相纸边
    backgroundColor: '#E3CDB4',
  },
  // 右上角的小 ✕:单独删这一张。
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#B26B24', // 波尔多红
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: { color: '#EDD8C3', fontSize: 10, lineHeight: 12 },

  // 底单(遮罩 / 圆角 / 抓手 / 滑入+下拉手势)已收进 BottomSheet 组件,这里只留内容样式。
  dateHero: {
    fontFamily: 'CourierPrime_400Regular',
    fontSize: 19,
    lineHeight: 25,
    letterSpacing: -0.3,
    color: '#5A3A24',
    textAlign: 'center',
  },
  // 标题下方的浅分割线:满宽、极细,暖浅金(#EFDFC0)。
  dateHeroDivider: { alignSelf: 'stretch', height: 1, backgroundColor: '#EFDFC0' },
  backLink: { marginTop: 4, paddingVertical: 8, paddingHorizontal: 16 },
  backLinkText: { fontSize: 14, color: '#9A7E5C' },

  sealButton: {
    backgroundColor: '#B26B24', // 品牌主题色
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 0, // 直角(用户要求按钮不要圆角)
    alignItems: 'center',
    alignSelf: 'stretch', // 写信屏的 footer 里照样撑满
  },
  // 在底单里:把 Seal 按钮往日历那边收紧一点(BottomSheet 子项默认 gap 18,这里抵消一截)。
  sealButtonInSheet: { marginTop: -8 },
  sealButtonDisabled: { backgroundColor: '#C9B097' }, // 未激活:暖灰玫瑰(不满足条件)
  sealButtonText: { fontFamily: 'CourierPrime_400Regular', color: '#FBEFDB', fontSize: 16, letterSpacing: 0.5 }, // Courier Prime 16,暖近白

  // 封存后那一屏:内容居中 + 按钮沉底(对齐设计图)。
  sealedScreen: {
    flex: 1,
    backgroundColor: '#FAE6C9', // 与首页一致的干净奶油底
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
    fontFamily: 'CourierPrime_700Bold',
    fontSize: 18,
    color: '#84410F',
    letterSpacing: -0.9,
    marginTop: 4,
  },
  // 描述:Courier Prime 常规,赤陶色,居中,行高 20(用户规格)。
  sealedHint: {
    fontFamily: 'CourierPrime_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#B26B24',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
