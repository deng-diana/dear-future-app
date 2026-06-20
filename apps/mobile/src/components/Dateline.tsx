/**
 * Dateline — 信纸顶部邮戳:日期 / 城市 / 时间
 * 城市行可点击编辑,保存到 AsyncStorage key `reunite.city`
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

const CITY_KEY = 'reunite.city';

// 从时区字符串推断城市名:取最后一段,下划线换空格。
// 例:America/New_York → New York,Asia/Shanghai → Shanghai
function cityFromTimezone(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return tz.split('/').pop()?.replace(/_/g, ' ') ?? '';
}

export default function Dateline() {
  // 进屏时算一次邮戳快照,之后不再变(像写信那一刻钉住的时间)
  const stamp = useMemo(() => {
    const now = new Date();
    return {
      date: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    };
  }, []);

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
      {/* 第一行:日期(只读) */}
      <Text style={styles.line}>{stamp.date}</Text>

      {/* 第二行:城市(可编辑)
          不在编辑时:看起来和日期行一模一样,只有极淡的点线下划线暗示"可点"
          点击后:切换成同样字体/大小的 TextInput */}
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
          selectionColor="#B7864E"
          onBlur={commitEdit}
          onSubmitEditing={commitEdit}
        />
      ) : (
        <Text
          style={[styles.line, styles.cityText]}
          onPress={() => {
            setDraft(city);
            setEditing(true);
          }}
          suppressHighlighting>
          {city}
        </Text>
      )}

      {/* 第三行:时间(只读) */}
      <Text style={styles.line}>{stamp.time}</Text>
    </View>
  );
}

const lineBase = {
  fontFamily: 'IBMPlexMono_500Medium',
  fontSize: 14,
  lineHeight: 22,
  color: '#6B5A4B',
  letterSpacing: 1.1,
} as const;

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingTop: 4,
  },
  line: lineBase,
  // 城市文字:和其他行完全一样,只加一条极淡的点线下划线作为"可编辑"暗示
  cityText: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: '#C9B6A6',
  },
  // 城市编辑框:和 Text 行保持同等间距
  cityInput: {
    padding: 0,     // 抹掉 TextInput 自带的内边距,与 Text 行对齐
    margin: 0,
    height: 22,     // 和 lineHeight 一致,防止高度抖动
  },
});
