import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/theme';

// 自制的 Courier Prime 月历:纯 React Native,iOS / Web 都能跑(不依赖原生组件)。
// 故意做得克制、留白多、方角、无图片 —— 像一张纸上手画的日历。
//
// 2026-07 升级(创始人 mockup 定稿,原型演进见 /playground/date):
//   1. 「誓言快捷键」—— 日历下方一排横滑胶囊(In 1 year … In 10 years,#FAE6C9 暖纸底),
//      贴近拇指;点一下 = 选中「N 年后的今天」并把日历翻到那个月(仍可微调)。
//   2. 月年标题可点(金色点状下划线)—— 点 "July 2027" 原地切换成
//      「选年 → 选月 → 回到日」的跳转流,解决"选 3 年后要按 36 下箭头"的痛。
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

// N 年后的「同月同日」;2月29日 + 1年 这类不存在的日子,夹到当月最后一天(2月28日)。
function addYears(base: Date, n: number): Date {
  const d = startOfDay(base);
  const y = d.getFullYear() + n;
  const daysInTarget = new Date(y, d.getMonth() + 1, 0).getDate();
  return new Date(y, d.getMonth(), Math.min(d.getDate(), daysInTarget));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // 单字母即可

// 誓言快捷键(创始人定稿 2026-07-04):日历下方、横滑胶囊、贴近拇指。
const VOWS = [
  { label: 'In 1 year', years: 1 },
  { label: 'In 2 years', years: 2 },
  { label: 'In 3 years', years: 3 },
  { label: 'In 5 years', years: 5 },
  { label: 'In 10 years', years: 10 },
] as const;

export default function Calendar({ value, minDate, onChange }: Props) {
  const min = startOfDay(minDate); // 归零的下限,后面所有比较都用它
  const today = startOfDay(new Date()); // 誓言快捷键以「今天」为锚(N 年后的今天)

  // viewMonth = 当前显示月份的"1 号"。初值:有选中就用选中的月,否则用下限的月。
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const base = value ?? minDate;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  // 跳转流:day = 正常日历;year = 选年;month = 选月(pendingYear 记住刚选的年)。
  const [mode, setMode] = useState<'day' | 'year' | 'month'>('day');
  const [pendingYear, setPendingYear] = useState<number | null>(null);

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

  // 誓言快捷键:选中 N 年后的今天 + 把日历翻到那个月(研究指出的坑:两者缺一不可)。
  function pickVow(years: number) {
    const d = addYears(today, years);
    onChange(d);
    setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    setMode('day');
    setPendingYear(null);
  }

  // 年份九宫格:下限年 → +10(共 11 个,3 列)。
  const yearOptions = Array.from({ length: 11 }, (_, i) => min.getFullYear() + i);

  // 拼出 6 行 × 7 列的格子:前面补 firstWeekday 个空格,再排 1..daysInMonth。
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length < 42) cells.push(null); // 补满 6 行,布局稳定

  return (
    <View style={styles.container}>
      {/* 头部:day 模式 = ‹ July 2027 ›(标题可点进跳转流);year/month 模式 = 流程标题(点了回到日历)。 */}
      {mode === 'day' ? (
        <View style={styles.header}>
          {/* A6: 翻页箭头加上无障碍标签(屏幕阅读器报出"Previous month" / "Next month") */}
          <Pressable onPress={goPrev} disabled={!canGoPrev} hitSlop={10} style={styles.chevronHit} accessibilityRole="button" accessibilityLabel="Previous month">
            <Text style={[styles.chevron, !canGoPrev && styles.chevronHidden]}>‹</Text>
          </Pressable>
          <Pressable
            onPress={() => setMode('year')}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Change month and year">
            <Text style={[styles.monthLabel, styles.tappableLabel]}>
              {MONTHS[month]} {year}
            </Text>
          </Pressable>
          <Pressable onPress={goNext} hitSlop={10} style={styles.chevronHit} accessibilityRole="button" accessibilityLabel="Next month">
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.header}>
          <View style={styles.chevronHit} />
          <Pressable
            onPress={() => { setMode('day'); setPendingYear(null); }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back to the calendar">
            <Text style={styles.monthLabel}>
              {mode === 'year' ? 'Choose a year' : `${pendingYear} · choose a month`}
            </Text>
          </Pressable>
          <View style={styles.chevronHit} />
        </View>
      )}

      {mode === 'day' && (
        <>
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

        </>
      )}

      {/* 选年:下限年 → +10,3 列。格子复用 day 的尺寸节奏,不引入新视觉。 */}
      {mode === 'year' && (
        <View style={styles.jumpGrid}>
          {yearOptions.map((y) => (
            <Pressable
              key={y}
              style={styles.jumpCell}
              onPress={() => { setPendingYear(y); setMode('month'); }}
              accessibilityRole="button"
              accessibilityLabel={`Year ${y}`}>
              <Text style={[styles.jumpText, y === year && styles.jumpTextCurrent]}>{y}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* 选月:12 个月,3 列;整月早于下限的灰掉(和灰色日期同语言)。 */}
      {mode === 'month' && pendingYear != null && (
        <View style={styles.jumpGrid}>
          {MONTHS.map((m, idx) => {
            const monthEnd = new Date(pendingYear, idx + 1, 0); // 该月最后一天
            const disabled = startOfDay(monthEnd).getTime() < min.getTime();
            return (
              <Pressable
                key={m}
                style={styles.jumpCell}
                disabled={disabled}
                onPress={() => {
                  setViewMonth(new Date(pendingYear, idx, 1));
                  setMode('day');
                  setPendingYear(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${m} ${pendingYear}`}
                accessibilityState={{ disabled }}>
                <Text style={[styles.jumpText, disabled && styles.dayTextDisabled]}>{m.slice(0, 3)}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* 誓言快捷键:日历下方、横滑胶囊(创始人 mockup 定稿)—— 贴近拇指,
          背景 #FAE6C9 与 Seal 按钮明确区分。点一下 = 选中 N 年后的今天并翻到那个月。 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.vowScroll}
        contentContainerStyle={styles.vowScrollContent}>
        {VOWS.map((v) => {
          const target = addYears(today, v.years);
          const current = value != null && sameDay(target, value);
          return (
            <Pressable
              key={v.years}
              onPress={() => pickVow(v.years)}
              style={[styles.vowPill, current && styles.vowPillCurrent]}
              accessibilityRole="button"
              accessibilityLabel={`Deliver ${v.label.toLowerCase()}, ${MONTHS[target.getMonth()]} ${target.getDate()}, ${target.getFullYear()}`}
              accessibilityState={{ selected: current }}>
              <Text style={[styles.vowPillText, current && styles.vowPillTextCurrent]}>{v.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
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

  // 誓言快捷键胶囊(日历下方,横滑):#FAE6C9 暖纸底 + 圆角;选中态加深文字。
  vowScroll: { alignSelf: 'stretch', marginTop: 16 },
  vowScrollContent: { gap: 10, paddingVertical: 2 },
  vowPill: {
    backgroundColor: colors.surfaceChip, // 语义 token(#FAE6C9 暖沙纸)
    borderRadius: 0, // 直角 —— 与 Seal/Start 按钮同一套品牌语言
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  vowPillCurrent: { backgroundColor: colors.surfaceChipSelected }, // 选中:更亮的暖沙(#FFDAA6)
  vowPillText: { fontFamily: fonts.regular, fontSize: 14, color: colors.textBody },
  vowPillTextCurrent: { color: colors.brandText },

  // 头部行:左右箭头 + 居中的"月 年"。
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  chevronHit: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  chevron: { fontFamily: fonts.regular, fontSize: 24, color: colors.brand, lineHeight: 26 },
  chevronHidden: { opacity: 0 }, // 到下限月就藏起左箭头(占位不跳动)
  monthLabel: { fontFamily: fonts.regular, fontSize: 18, color: colors.textHeading },
  // 月年标题的可点暗号:与誓言行同一套点状下划线。
  tappableLabel: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: colors.accentGold,
  },

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
  dayTextDisabled: { color: colors.textDisabled }, // 早于下限:更浅的禁用色,明显区分可选/不可选(disabled WCAG 豁免)
  dayTextSelected: { color: colors.background }, // 选中:奶白字

  // 选年/选月的九宫格:3 列,复用 day 的行高节奏;高度与 6 行日历相当,切换不跳动太大。
  jumpGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  jumpCell: { width: '33.33%', minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  jumpText: { fontFamily: fonts.regular, fontSize: 17, color: colors.textBody },
  jumpTextCurrent: { color: colors.brandText },

});
