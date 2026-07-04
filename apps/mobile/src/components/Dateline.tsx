/**
 * Dateline — 信纸顶部邮戳:日期 / 城市 / 时间
 * 城市行可点击编辑,保存到 AsyncStorage key `reunite.city`
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, fonts } from '@/theme';

const CITY_KEY = 'reunite.city';

// 可选:演示用隐藏手势 —— 长按日期那行回到开场页(用户看不见,演示者知道)。
type Props = {
  onLongPress?: () => void;
};

// 从时区字符串推断城市名:取最后一段,下划线换空格。
// 例:America/New_York → New York,Asia/Shanghai → Shanghai
function cityFromTimezone(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return tz.split('/').pop()?.replace(/_/g, ' ') ?? '';
}

export default function Dateline({ onLongPress }: Props) {
  // 活邮戳(2026-07-04 用户反馈定稿):时间实时走 —— 写到凌晨 2:04,邮戳就该盖 2:04 AM。
  // 那是信的一部分。每 5 秒对表一次,但只在「分钟真的变了」才触发重渲染(平时零开销);
  // 5 秒的对表间隔也顺便覆盖了从后台切回来时的时钟追赶。
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => {
      setNow((prev) => {
        const n = new Date();
        return n.getMinutes() === prev.getMinutes() && n.getHours() === prev.getHours() && n.getDate() === prev.getDate()
          ? prev
          : n;
      });
    }, 5000);
    return () => clearInterval(id);
  }, []);
  const stamp = useMemo(
    () => ({
      date: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    }),
    [now],
  );

  // 时区推断出来的城市:作为没有保存值时的兜底
  const tzCity = useMemo(cityFromTimezone, []);

  // 当前显示的城市(先用时区值,AsyncStorage 读完再替换)
  const [city, setCity] = useState(tzCity);
  // 是否处于编辑模式
  const [editing, setEditing] = useState(false);
  // 编辑框内的草稿文字
  const [draft, setDraft] = useState(tzCity);
  // 用来在编辑完成时读到最新 draft(闭包陷阱预防)
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // 组件挂载时从 AsyncStorage 加载之前保存的城市
  useEffect(() => {
    AsyncStorage.getItem(CITY_KEY).then((saved) => {
      if (saved && saved.trim().length > 0) {
        setCity(saved);
        setDraft(saved);
      }
    });
  }, []);

  // 提交编辑:空输入回退到时区城市,否则保存
  function commitEdit() {
    const value = draftRef.current.trim() || tzCity;
    setCity(value);
    setEditing(false);
    AsyncStorage.setItem(CITY_KEY, value);
  }

  return (
    <View style={styles.container}>
      {/* 第一行:Today · 日期 —— 一个安静的词消除歧义(这是「写信此刻」,不是送达日)。
          长按 = 演示用隐藏手势,回到开场页。 */}
      <Text style={styles.line} onLongPress={onLongPress} suppressHighlighting>
        Today · {stamp.date}
      </Text>

      {/* 第二行:城市(可编辑)+ 时间(实时)并排 —— 邮戳收成两行,写信区更宽敞。
          城市不在编辑时:和日期行一模一样,只有极淡的点线下划线暗示"可点"。 */}
      <View style={styles.cityRow}>
        {editing ? (
          <TextInput
            style={[styles.line, styles.cityInput]}
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              draftRef.current = t;
            }}
            autoFocus
            autoCapitalize="words"
            returnKeyType="done"
            selectionColor={colors.cursor}
            onBlur={commitEdit}
            onSubmitEditing={commitEdit}
          />
        ) : (
          // A12: 城市可编辑区域 — 告知屏幕阅读器这是一个按钮(role)并说明操作(hint)
          <Text
            style={[styles.line, styles.cityText]}
            onPress={() => {
              setDraft(city);
              setEditing(true);
            }}
            accessibilityRole="button"
            accessibilityHint="Edit your city"
            suppressHighlighting>
            {city}
          </Text>
        )}
        <Text style={styles.line}> · {stamp.time}</Text>
      </View>
    </View>
  );
}

const lineBase = {
  fontFamily: fonts.regular,
  fontSize: 14,
  lineHeight: 22,
  color: colors.brandText, // B: brand 文字场景换用更深的 brandText(#84410F),达到 ≥4.5:1(AA)
  letterSpacing: 1.1,
} as const;

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 32, // 与信正文左对齐(右移一点)
    paddingTop: 16,        // 向下一点,保持同样的页边距
  },
  line: lineBase,
  // 城市 + 时间同一行(基线对齐;编辑态时输入框与时间并排不跳动)。
  cityRow: { flexDirection: 'row', alignItems: 'baseline' },
  // 城市文字:和其他行完全一样,只加一条极淡的点线下划线作为"可编辑"暗示
  cityText: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: colors.border,
  },
  // 城市编辑框:和 Text 行保持同等间距
  cityInput: {
    padding: 0,        // 抹掉 TextInput 自带的内边距,与 Text 行对齐
    margin: 0,
    minHeight: 22,     // A14: height → minHeight,动态字号时不裁字
  },
});
