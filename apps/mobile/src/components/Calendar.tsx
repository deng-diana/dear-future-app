import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

// 自制的 Courier Prime 月历:纯 React Native,iOS / Web 都能跑(不依赖原生组件)。
// 故意做得克制、留白多、方角、无图片 —— 像一张纸上手画的日历。
type Props = {
  value: Date | null; // 当前选中的送达日(还没选就是 null)
  minDate: Date; // 最早可选日(早于它的天都灰掉、不可点)
  onChange: (d: Date) => void; // 选了某天 → 回调出去
};

// 把日期"归零"到当天 00:00,只按"整天"比较,不掺时分秒。
function startOfDay(base: Date): Date {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  return d;
}

// 同一天吗?(按 年/月/日 比,忽略时分秒)
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // 单字母即可

export default function Calendar({ value, minDate, onChange }: Props) {
  const min = startOfDay(minDate); // 归零的下限,后面所有比较都用它

  // viewMonth = 当前显示月份的"1 号"。初值:有选中就用选中的月,否则用下限的月。
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const base = value ?? minDate;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();

  // 这个月有几天、1 号是周几(0=周日)。
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();

  // 能不能往前翻?—— 显示月若已经是下限那个月(或更早),就不能再往前。
  const minMonthStart = new Date(min.getFullYear(), min.getMonth(), 1);
  const canGoPrev = viewMonth.getTime() > minMonthStart.getTime();

  function goPrev() {
    if (!canGoPrev) return;
    setViewMonth(new Date(year, month - 1, 1));
  }
  function goNext() {
    setViewMonth(new Date(year, month + 1, 1));
  }

  // 拼出 6 行 × 7 列的格子:前面补 firstWeekday 个空格,再排 1..daysInMonth。
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length < 42) cells.push(null); // 补满 6 行,布局稳定

  return (
    <View style={styles.container}>
      {/* 头部:‹  June 2026  › */}
      <View style={styles.header}>
        <Pressable onPress={goPrev} disabled={!canGoPrev} hitSlop={10} style={styles.chevronHit} accessibilityRole="button">
          <Text style={[styles.chevron, !canGoPrev && styles.chevronHidden]}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel}>
          {MONTHS[month]} {year}
        </Text>
        <Pressable onPress={goNext} hitSlop={10} style={styles.chevronHit} accessibilityRole="button">
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      {/* 星期表头:S M T W T F S */}
      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <View key={i} style={styles.cell}>
            <Text style={styles.weekday}>{w}</Text>
          </View>
        ))}
      </View>

      {/* 日期网格:6 行 × 7 列 */}
      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (day === null) {
            return <View key={i} style={styles.cell} />; // 空格(占位,不可点)
          }
          const thisDate = new Date(year, month, day);
          const disabled = startOfDay(thisDate).getTime() < min.getTime(); // 早于下限 → 灰、不可点
          const selected = value != null && sameDay(thisDate, value); // 是被选中的那天?

          return (
            <Pressable
              key={i}
              style={styles.cell}
              disabled={disabled}
              onPress={() => onChange(new Date(year, month, day))}
              accessibilityRole="button"
              accessibilityState={{ disabled, selected }}>
              <View style={[styles.dayCircle, selected && styles.dayCircleSelected]}>
                <Text style={[styles.dayText, disabled && styles.dayTextDisabled, selected && styles.dayTextSelected]}>{day}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 320, alignSelf: 'center' },

  // 头部行:左右箭头 + 居中的"月 年"。
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  chevronHit: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  chevron: { fontFamily: 'CourierPrime_400Regular', fontSize: 24, color: '#B26B24', lineHeight: 26 },
  chevronHidden: { opacity: 0 }, // 到下限月就藏起左箭头(占位不跳动)
  monthLabel: { fontFamily: 'CourierPrime_400Regular', fontSize: 16, color: '#5A3A24' },

  // 星期表头一行 7 列。
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekday: { fontFamily: 'CourierPrime_400Regular', fontSize: 12, color: '#9A7E5C' },

  // 网格:横向换行,每格占 1/7 宽。
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: 42, alignItems: 'center', justifyContent: 'center' },

  // 每天的数字外面一个透明圆;选中那天填成主题色实心圆。
  dayCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dayCircleSelected: { backgroundColor: '#B26B24' },
  dayText: { fontFamily: 'CourierPrime_400Regular', fontSize: 15, color: '#67350F' },
  dayTextDisabled: { color: '#B09A80' }, // 早于下限:灰
  dayTextSelected: { color: '#FAE6C9' }, // 选中:奶白字
});
