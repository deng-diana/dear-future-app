import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/theme';

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
        {/* A6: 翻页箭头加上无障碍标签(屏幕阅读器报出"Previous month" / "Next month") */}
        <Pressable onPress={goPrev} disabled={!canGoPrev} hitSlop={10} style={styles.chevronHit} accessibilityRole="button" accessibilityLabel="Previous month">
          <Text style={[styles.chevron, !canGoPrev && styles.chevronHidden]}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel}>
          {MONTHS[month]} {year}
        </Text>
        <Pressable onPress={goNext} hitSlop={10} style={styles.chevronHit} accessibilityRole="button" accessibilityLabel="Next month">
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      {/* Weekday header: S M T W T F S — same 7-column row structure as grid rows */}
      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <View key={i} style={styles.cell}>
            <Text style={styles.weekday}>{w}</Text>
          </View>
        ))}
      </View>

      {/* Date grid: explicit rows of exactly 7 cells; flex:1 per cell avoids
          floating-point percentage wrap that caused the phantom empty row. */}
      <View style={styles.grid}>
        {Array.from({ length: 6 }, (_, rowIdx) => {
          const rowCells = cells.slice(rowIdx * 7, rowIdx * 7 + 7);
          return (
            <View key={rowIdx} style={styles.gridRow}>
              {rowCells.map((day, colIdx) => {
                const cellKey = rowIdx * 7 + colIdx;
                if (day === null) {
                  return <View key={cellKey} style={styles.cell} />; // blank spacer, not tappable
                }
                const thisDate = new Date(year, month, day);
                const disabled = startOfDay(thisDate).getTime() < min.getTime(); // before min → grey, untappable
                const selected = value != null && sameDay(thisDate, value); // is this the chosen day?

                return (
                  <Pressable
                    key={cellKey}
                    style={styles.cell}
                    disabled={disabled}
                    onPress={() => onChange(new Date(year, month, day))}
                    accessibilityRole="button"
                    accessibilityLabel={`${MONTHS[month]} ${day}, ${year}`}
                    accessibilityState={{ disabled, selected }}>
                    {/* A6: accessibilityLabel lets screen readers announce the full date (e.g. "June 22, 2027") */}
                    <View style={[styles.dayCircle, selected && styles.dayCircleSelected]}>
                      <Text style={[styles.dayText, disabled && styles.dayTextDisabled, selected && styles.dayTextSelected]}>{day}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 无框日历:不要奶油盒子,直接裸在底单上,撑满内容宽度(与标题、Seal 按钮同宽)。
  // 表头行(weekRow)与日期网格(grid)同宽、同一套 cell 样式,7 列严格对齐铺满。
  container: {
    width: '100%',
    alignSelf: 'stretch',
  },

  // 头部行:左右箭头 + 居中的"月 年"。
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  chevronHit: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  chevron: { fontFamily: fonts.regular, fontSize: 24, color: colors.brand, lineHeight: 26 },
  chevronHidden: { opacity: 0 }, // 到下限月就藏起左箭头(占位不跳动)
  monthLabel: { fontFamily: fonts.regular, fontSize: 18, color: colors.textHeading },

  // Weekday header: one row of 7 flex:1 cells, same structure as each grid row.
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekday: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted },

  // Grid: a column of rows; each row is a flexDirection:'row' View with 7 flex:1 cells.
  // flex:1 on each cell gives exact equal division with no floating-point rounding.
  grid: { flexDirection: 'column' },
  gridRow: { flexDirection: 'row' },
  // A14: minHeight so tall dynamic-type text is never clipped; flex:1 fills 1/7 of the row exactly.
  cell: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },

  // 每天的数字外面一个透明圆;选中那天填成更深的品牌色实心圆(奶白字 ≥4.5:1 AA)。
  dayCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dayCircleSelected: { backgroundColor: colors.brandSelected }, // B: 加深选中背景至 brandDark,确保对比度 AA
  dayText: { fontFamily: fonts.regular, fontSize: 17, color: colors.textBody },
  dayTextDisabled: { color: colors.textMutedLight }, // 早于下限:灰(disabled 态 WCAG 豁免)
  dayTextSelected: { color: colors.background }, // 选中:奶白字
});
