import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
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

  // 封存:把信真正写进 Supabase 的 letters 表。
  async function handleSeal() {
    const { error } = await supabase.from('letters').insert({
      owner_email: 'test@dearfuture.app', // 临时占位;下一步加邮箱 OTP 后换成验证过的真邮箱
      body: letter.trim(),
      deliver_on: toISODate(effectiveDate),
    });
    if (error) {
      console.log('封存失败:', error.message);
      return; // 没写成功就不切到"已封存"屏,信还在,可重试
    }
    setSealed(true);
  }

  // 岔路口①:已封存 → 写信的纸消失,只剩一句安静的话。
  if (sealed) {
    return (
      <SafeAreaView style={styles.sealedScreen}>
        <Text style={styles.sealedText}>🕯️ 信已封存</Text>
        <Text style={styles.sealedHint}>它会在那一天,回到你身边。</Text>
      </SafeAreaView>
    );
  }

  // 岔路口②:还没封存 → 照常写信 + 选日期 + 封存按钮。
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TextInput
          style={styles.input}
          value={letter}
          onChangeText={setLetter}
          placeholder="亲爱的未来的我……"
          placeholderTextColor="#b3a99a"
          multiline
          autoFocus
          textAlignVertical="top"
        />

        <View style={styles.footer}>
          {/* 选送达日期。minimumDate 让比 15 天更近的日子根本选不了。 */}
          <View style={styles.dateRow}>
            <Text style={styles.dateLabel}>它哪天回到你身边?</Text>
            <DateTimePicker
              mode="date"
              display="compact"
              presentation="inline"
              value={effectiveDate}
              minimumDate={earliest}
              locale="zh_CN"
              accentColor="#3a3a3a"
              onValueChange={(_event, date) => setDeliverOn(startOfDay(date))}
              style={styles.datePicker}
            />
          </View>

          <Text style={styles.earliestHint}>
            最早 {formatDate(earliest)}({MIN_SEAL_DAYS} 天后)
          </Text>

          <Pressable
            style={[styles.sealButton, !canSeal && styles.sealButtonDisabled]}
            onPress={handleSeal}
            disabled={!canSeal}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSeal }}>
            <Text style={styles.sealButtonText}>封 存</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: '#fbf6ec' },
  input: { flex: 1, padding: 24, fontSize: 18, lineHeight: 30, color: '#33302b' },

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
  sealedHint: { fontSize: 15, color: '#8a8175' },
});
