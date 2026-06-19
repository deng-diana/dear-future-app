import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AccountButton from '@/components/AccountButton';
import SignIn from '@/components/SignIn';
import { MIN_SEAL_DAYS } from '@/constants/rules';
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

// 把日期显示成「2026年6月27日」—— 跟随系统的中文格式化(和选择器 locale 一致),省去手写拼接。
function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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
  const [sealed, setSealed] = useState(false); // 封存了没?

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

  // 写信此刻的"邮戳":日期 + 城市(从时区推断,不要定位权限)+ 时间。
  // useMemo([]) 只在进屏时算一次 —— 像信纸顶端写下的那一刻,定住不动。
  const stamp = useMemo(() => {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; // 例:Europe/London
    const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? ''; // → London
    return { date: formatDate(now), time, city };
  }, []);

  // 真正把信写进 Supabase 的 letters 表。
  // 只送"信的内容 + 送达日";主人(owner_id)由数据库按当前登录的人自动填。
  async function doSeal() {
    const { error } = await supabase.from('letters').insert({
      body: letter.trim(),
      deliver_on: toISODate(effectiveDate),
    });
    if (error) {
      console.log('封存失败:', error.message);
      return; // 没写成功就不切到"已封存"屏,信还在,可重试
    }
    setSealed(true);
  }

  // 按「封存」:没登录就先弹登录;已登录就直接封。
  function handleSeal() {
    if (!session) {
      setShowSignIn(true);
      return;
    }
    doSeal();
  }

  // 封存之后想再写一封:清空内容、回到全新写信屏(但仍保持登录)。
  function writeAnother() {
    setLetter('');
    setDeliverOn(null);
    setSealed(false);
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
      {/*
        已登录时:头像行放在 SafeAreaView 最顶部(普通 flex 流,非绝对定位)。
        SafeAreaView 的 padding-top 已被证明能正确推开刘海,头像行自然落在刘海下方。
      */}
      {session ? <AccountButton email={session.user.email!} onSignOut={confirmSignOut} /> : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* 顶部邮戳:此刻的日期 / 城市 / 时间 —— "此刻的你"。 */}
        <View style={styles.dateline}>
          <Text style={styles.datelineText}>{stamp.date}</Text>
          {stamp.city ? <Text style={styles.datelineText}>{stamp.city}</Text> : null}
          <Text style={styles.datelineText}>{stamp.time}</Text>
        </View>

        <TextInput
          style={styles.input}
          value={letter}
          onChangeText={setLetter}
          placeholder="Dear future me…"
          placeholderTextColor="#b3a99a"
          multiline
          autoFocus
          textAlignVertical="top"
        />

        {/* 还没写字时,底部完全隐藏 —— 守"一张干净的纸"。一旦动笔,日期 + 封存才出现。 */}
        {canSeal ? (
          <View style={styles.footer}>
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
              style={[styles.sealButton, !canSeal && styles.sealButtonDisabled]}
              onPress={handleSeal}
              disabled={!canSeal}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSeal }}>
              <Text style={styles.sealButtonText}>Seal</Text>
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: '#fbf6ec' },
  input: { flex: 1, padding: 24, fontSize: 18, lineHeight: 30, color: '#33302b' },

  // 顶部邮戳:打字机字体 + 暖棕色,左缘与信纸正文对齐(都是 24)。
  dateline: { paddingHorizontal: 24, paddingTop: 4, gap: 2 },
  datelineText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontSize: 13,
    color: '#9a8b6c',
    letterSpacing: 0.5,
  },

  footer: { padding: 16, gap: 10 },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateLabel: { fontSize: 15, color: '#8a8175' },
  datePicker: { width: 140, height: 40 },
  earliestHint: { fontSize: 12, color: '#b3a99a', textAlign: 'right' },

  sealButton: {
    backgroundColor: '#3a3a3a',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  sealButtonDisabled: { backgroundColor: '#ddd5c7' }, // 不满足条件:按钮变灰
  sealButtonText: { color: '#fbf6ec', fontSize: 17, fontWeight: '600', letterSpacing: 4 },

  // 封存后那一屏
  sealedScreen: {
    flex: 1,
    backgroundColor: '#fbf6ec',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  sealedText: { fontSize: 22, color: '#33302b' },
  sealedHint: { fontSize: 15, color: '#8a8175', textAlign: 'center', paddingHorizontal: 32 },
  writeAnother: { marginTop: 32, paddingVertical: 10, paddingHorizontal: 20 },
  writeAnotherText: { fontSize: 15, color: '#8a8175', textDecorationLine: 'underline' },
});
