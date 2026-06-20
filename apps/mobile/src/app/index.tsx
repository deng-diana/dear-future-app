import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AccountButton from '@/components/AccountButton';
import Dateline from '@/components/Dateline';
import PaperBackground from '@/components/PaperBackground';
import SealCeremony from '@/components/SealCeremony';
import SignIn from '@/components/SignIn';
import { DEMO_MODE, MIN_SEAL_DAYS } from '@/constants/rules';
import { pickPhoto, pickVideo, randomFolder, uploadMedia, type PickedMedia } from '@/lib/media';
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
  const [letter, setLetter] = useState(''); // 信里写了什么
  const [sealing, setSealing] = useState(false); // 正在播封存仪式动画?
  const [sealed, setSealed] = useState(false); // 封存了没?

  // 可选附件:1 张照片 + 1 段短视频(封存时一起上传)。
  const [photo, setPhoto] = useState<PickedMedia | null>(null);
  const [video, setVideo] = useState<PickedMedia | null>(null);
  const [busy, setBusy] = useState(false); // 正在上传媒体 + 写库(按 Seal 后那一下)

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
  const canSeal = letter.trim().length > 0;

  // 背景"呼吸":一层极淡的暖色,缓缓在 0 ↔ 0.05 之间起伏(约 9 秒一轮),
  // 让纸面像活着、有温度,但几乎察觉不到。用内置 Animated(零配置,稳)。
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 4500, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 4500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath]);
  const breathOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0, 0.05] });

  // 真正把信写进 Supabase 的 letters 表。
  // 只送"信的内容 + 送达日";主人(owner_id)由数据库按当前登录的人自动填。
  async function doSeal() {
    setBusy(true); // 上传 + 写库期间,按钮转圈、防重复点
    // 先把照片 / 视频传到 memories 桶(同一个随机文件夹),拿到公开 URL。
    let photoUrl: string | null = null;
    let videoUrl: string | null = null;
    if (photo || video) {
      const folder = randomFolder();
      if (photo) photoUrl = await uploadMedia(photo, folder);
      if (video) videoUrl = await uploadMedia(video, folder);
    }
    const { error } = await supabase.from('letters').insert({
      body: letter.trim(),
      deliver_on: toISODate(effectiveDate),
      photo_url: photoUrl,
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

  // 按「封存」:正在忙就忽略;没登录就先弹登录;已登录就直接封。
  function handleSeal() {
    if (busy) return;
    if (!session) {
      setShowSignIn(true);
      return;
    }
    doSeal();
  }

  // 选 1 张照片 / 1 段视频(从相册)。
  async function addPhoto() {
    const m = await pickPhoto();
    if (m) setPhoto(m);
  }
  async function addVideo() {
    const m = await pickVideo();
    if (m) setVideo(m);
  }

  // 封存之后想再写一封:清空内容 + 清掉附件,回到全新写信屏(但仍保持登录)。
  function writeAnother() {
    setLetter('');
    setDeliverOn(null);
    setSealed(false);
    setPhoto(null);
    setVideo(null);
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
      <SafeAreaView style={styles.sealedScreen}>
        <Text style={styles.sealedText}>🕯️ Sealed</Text>
        <Text style={styles.sealedHint}>It will find its way back to you — on a day you've long forgotten.</Text>
        <Pressable onPress={writeAnother} style={styles.writeAnother} accessibilityRole="button">
          <Text style={styles.writeAnotherText}>Write another</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // 岔路口②:还没封存 → 照常写信 + 选日期 + 封存按钮。
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      {/* 纸张质感包裹层:象牙底 + 极淡颗粒 + 内晕 + 右下角翘角。 */}
      <PaperBackground>
        {/* 背景呼吸层:绝对铺满、不挡触摸,opacity 由 Animated 缓缓起伏。 */}
        <Animated.View pointerEvents="none" style={[styles.breath, { opacity: breathOpacity }]} />

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

          {/* 永久题头:衬线大字,信纸的"称呼"。 */}
          <Text style={styles.title}>Dear future me,</Text>

        {/* 正文:在题头下面写;光标是暖金棕色。 */}
        <TextInput
          style={styles.input}
          value={letter}
          onChangeText={setLetter}
          multiline
          autoFocus
          textAlignVertical="top"
          selectionColor="#B7864E"
          cursorColor="#B7864E"
        />

        {/* 还没写字时,底部完全隐藏 —— 守"一张干净的纸"。一旦动笔,日期 + 封存才出现。 */}
        {canSeal ? (
          <View style={styles.footer}>
            {/* 可选附件:1 张照片 + 1 段视频。安静一行,守"写信为主"。 */}
            <View style={styles.mediaRow}>
              {photo ? (
                <Pressable onPress={() => setPhoto(null)} disabled={busy} accessibilityRole="button">
                  <Text style={styles.mediaOn}>📷 Photo  ✕</Text>
                </Pressable>
              ) : (
                <Pressable onPress={addPhoto} disabled={busy} accessibilityRole="button">
                  <Text style={styles.mediaAdd}>＋ Photo</Text>
                </Pressable>
              )}
              {video ? (
                <Pressable onPress={() => setVideo(null)} disabled={busy} accessibilityRole="button">
                  <Text style={styles.mediaOn}>🎬 Video  ✕</Text>
                </Pressable>
              ) : (
                <Pressable onPress={addVideo} disabled={busy} accessibilityRole="button">
                  <Text style={styles.mediaAdd}>＋ Video</Text>
                </Pressable>
              )}
            </View>

            {/* 选送达日期。minimumDate 让比 15 天更近的日子根本选不了。 */}
            <View style={styles.dateRow}>
              <Text style={styles.dateLabel}>When should it find you again?</Text>
              <DateTimePicker
                mode="date"
                display="compact"
                presentation="inline"
                value={effectiveDate}
                minimumDate={earliest}
                locale="en_US"
                accentColor="#3a3a3a"
                onValueChange={(_event, date) => setDeliverOn(startOfDay(date))}
                style={styles.datePicker}
              />
            </View>

            <Pressable
              style={[styles.sealButton, (!canSeal || busy) && styles.sealButtonDisabled]}
              onPress={handleSeal}
              disabled={!canSeal || busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSeal || busy }}>
              {busy ? (
                <ActivityIndicator color="#D6B26E" />
              ) : (
                <Text style={styles.sealButtonText}>✦ Seal ✦</Text>
              )}
            </Pressable>
          </View>
        ) : null}
        </KeyboardAvoidingView>
      </PaperBackground>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: '#F4EEE4' },

  // 背景呼吸层:一层极淡的暖色,铺满全屏(opacity 由动画控制)。
  breath: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#E4D4B8' },

  // 衬线题头「Dear future me,」。
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 36,
    lineHeight: 43,
    color: '#5B4638',
    paddingHorizontal: 24,
    marginTop: 18,
    marginBottom: 2,
  },

  // 正文:打字机字体 Courier Prime,暖色墨,左缘与题头对齐。
  input: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 6,
    paddingBottom: 24,
    fontFamily: 'CourierPrime_400Regular',
    fontSize: 16,
    lineHeight: 26,
    color: '#4A3D31',
  },

  footer: { padding: 16, gap: 10 },
  mediaRow: { flexDirection: 'row', gap: 22, paddingBottom: 2 },
  mediaAdd: { fontSize: 14, color: '#9a8b6c' }, // 未选:暖灰
  mediaOn: { fontSize: 14, color: '#7A1E1E' }, // 已选:波尔多红(✕ 可移除)
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateLabel: { fontSize: 15, color: '#8a8175' },
  datePicker: { width: 140, height: 40 },
  earliestHint: { fontSize: 12, color: '#b3a99a', textAlign: 'right' },

  sealButton: {
    backgroundColor: '#7A1E1E', // 品牌色:波尔多红
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  sealButtonDisabled: { backgroundColor: '#C9B6A6' }, // 未激活:暖灰玫瑰(不满足条件)
  sealButtonText: { color: '#D6B26E', fontSize: 17, fontWeight: '600', letterSpacing: 4 }, // 古金色文字

  // 封存后那一屏
  sealedScreen: {
    flex: 1,
    backgroundColor: '#F4EEE4',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  sealedText: { fontSize: 22, color: '#33302b' },
  sealedHint: { fontSize: 15, color: '#8a8175', textAlign: 'center', paddingHorizontal: 32 },
  writeAnother: { marginTop: 32, paddingVertical: 10, paddingHorizontal: 20 },
  writeAnotherText: { fontSize: 15, color: '#8a8175', textDecorationLine: 'underline' },
});
