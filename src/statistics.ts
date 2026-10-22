import { categoryKey, DEFAULT_CATEGORIES, type FocusCategory } from './categories';
import { categoryColor } from './category-icons';
export { CATEGORY_COLORS } from './category-icons';
import { dateKey, endDate, mondayOf, progress, weeksInMonth, type FocusRecord } from './domain';

export type AnalysisRange = 'today' | 'week' | 'month';
export type StatisticsState = { range: AnalysisRange; month: string; selectedBucket: string | null };
export type DateRange = { start: string; end: string };
export type StatisticsCategory = { id: string; name: string; color: string };
export type Totals = { totalMs: number; count: number; byCategory: Map<string, number> };
export type TrendBucket = Totals & DateRange & { id: string; label: string; secondary: string; description: string };
export type DistributionRow = StatisticsCategory & { milliseconds: number; share: number; percentage: number };
export type StatisticsModel = {
  today: string; currentMonth: string; selectedMonth: string; range: AnalysisRange;
  analysis: DateRange; analysisLabel: string; analysisTotals: Totals;
  todayMs: number; weekMs: number; streak: number;
  trendTitle: string; trendCaption: string; buckets: TrendBucket[]; categories: StatisticsCategory[];
  distribution: DistributionRow[];
  recentWeeks: (DateRange & { name: string; totalMs: number; share: number })[];
  growth: ReturnType<typeof progress>;
};

const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const localDate = (key: string) => new Date(`${key}T12:00:00`);
export function shiftDay(key: string, amount: number): string {
  const date = localDate(key);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}
const inRange = (records: FocusRecord[], period: DateRange) => records.filter(record => endDate(record) >= period.start && endDate(record) <= period.end);

export function sumRecords(records: FocusRecord[]): Totals {
  const byCategory = new Map<string, number>();
  let totalMs = 0;
  for (const record of records) {
    const milliseconds = Math.round(record.durationSeconds * 1000);
    totalMs += milliseconds;
    byCategory.set(record.categoryId, (byCategory.get(record.categoryId) || 0) + milliseconds);
  }
  return { totalMs, byCategory, count: records.length };
}

export function focusStreak(records: FocusRecord[], today: string): number {
  const days = new Set(records.filter(record => Number.isFinite(record.durationSeconds) && record.durationSeconds > 0 && endDate(record) <= today).map(endDate));
  let cursor = days.has(today) ? today : shiftDay(today, -1);
  let streak = 0;
  while (days.has(cursor)) { streak++; cursor = shiftDay(cursor, -1); }
  return streak;
}

export const shortDate = (key: string) => key.slice(5).replace('-', '.');
export const dateSpan = (range: DateRange) => range.start === range.end ? shortDate(range.start) : `${shortDate(range.start)} — ${shortDate(range.end)}`;
export function formatStatDuration(milliseconds: number): string {
  if (milliseconds <= 0) return '0 分钟';
  if (milliseconds < 60_000) return '少于 1 分钟';
  const minutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}` : `${minutes} 分钟`;
}

export function chartScale(maxMinutes: number) {
  const rough = Math.max(1, maxMinutes / 3);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map(factor => factor * magnitude).find(value => value >= rough)!;
  return { maximum: step * 3, ticks: [0, step, step * 2, step * 3] };
}

export function buildStatistics(records: FocusRecord[], catalogue: FocusCategory[], now: Date, state: StatisticsState): StatisticsModel {
  const today = dateKey(now);
  const currentMonth = today.slice(0, 7);
  const selectedMonth = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(state.month) && state.month <= currentMonth ? state.month : currentMonth;
  const [year, month] = selectedMonth.split('-').map(Number);
  const weeks = weeksInMonth(year, month);
  const currentWeekStart = dateKey(mondayOf(now));
  const analysis = state.range === 'today' ? { start: today, end: today }
    : state.range === 'week' ? { start: currentWeekStart, end: today }
    : { start: weeks[0].start, end: weeks.at(-1)!.end < today ? weeks.at(-1)!.end : today };
  const usable = records.filter(record => Number.isFinite(record.durationSeconds) && record.durationSeconds > 0 && endDate(record) <= today);
  const archivedIds = new Set(catalogue.filter(category => category.archived).map(category => category.id));
  const visibleRecords = usable.filter(record => !archivedIds.has(record.categoryId));
  const analysisRecords = inRange(visibleRecords, analysis);
  const analysisTotals = sumRecords(analysisRecords);
  const rolling = { start: shiftDay(today, -6), end: today };
  const trendRecords = state.range === 'week' ? inRange(visibleRecords, rolling) : analysisRecords;
  const metadata = new Map([...DEFAULT_CATEGORIES, ...catalogue].map(item => [item.id, item]));
  const names = new Map(records.map(record => [record.categoryId, record.category]));
  const defaultIds = DEFAULT_CATEGORIES.map(item => (catalogue.find(category => category.id === item.id) || catalogue.find(category => categoryKey(category.name) === categoryKey(item.name)) || item).id);
  const relevant = new Set([...defaultIds, ...analysisRecords.map(item => item.categoryId), ...trendRecords.map(item => item.categoryId)]);
  const rank = (id: string) => DEFAULT_CATEGORIES.findIndex(item => item.id === id);
  const categories = [...relevant].filter(id => !archivedIds.has(id)).sort((a, b) => {
    const aRank = rank(a), bRank = rank(b);
    if (aRank >= 0 || bRank >= 0) return (aRank < 0 ? DEFAULT_CATEGORIES.length : aRank) - (bRank < 0 ? DEFAULT_CATEGORIES.length : bRank);
    return (metadata.get(a)?.order ?? Number.MAX_SAFE_INTEGER) - (metadata.get(b)?.order ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b);
  }).map(id => {
    const name = metadata.get(id)?.name || names.get(id) || '未命名类别';
    return { id, name, color: categoryColor(id, name) };
  });

  const bucket = (period: DateRange, id: string, label: string, secondary: string, description: string): TrendBucket => ({
    ...period, id, label, secondary, description, ...sumRecords(inRange(visibleRecords, period)),
  });
  let buckets: TrendBucket[];
  if (state.range === 'today') {
    buckets = categories.map(category => {
      const subset = analysisRecords.filter(record => record.categoryId === category.id);
      return { ...analysis, id: `category-${category.id}`, label: category.name, secondary: '', description: `${today} · ${category.name}`, ...sumRecords(subset) };
    });
  } else if (state.range === 'month') {
    buckets = weeks.map(week => bucket(week, `week-${week.start}`, shortDate(week.start), `— ${shortDate(week.end)}`, `${week.start} — ${week.end}`));
  } else {
    buckets = Array.from({ length: 7 }, (_, index) => {
      const day = shiftDay(rolling.start, index);
      return bucket({ start: day, end: day }, `day-${day}`, shortDate(day), weekdays[localDate(day).getDay()], day);
    });
  }

  const distribution = categories.filter(category => rank(category.id) >= 0 || (analysisTotals.byCategory.get(category.id) || 0) > 0).map(category => {
    const milliseconds = analysisTotals.byCategory.get(category.id) || 0;
    const share = analysisTotals.totalMs ? milliseconds / analysisTotals.totalMs : 0;
    return { ...category, milliseconds, share, percentage: Math.floor(share * 100) };
  });
  // Distribute rounding remainders so the visible percentages add up to 100%.
  if (analysisTotals.totalMs) {
    const remainderOrder = distribution.map((row, index) => ({ index, fraction: row.share * 100 - row.percentage }))
      .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    let missing = 100 - distribution.reduce((sum, row) => sum + row.percentage, 0);
    for (const item of remainderOrder) {
      if (missing <= 0) break;
      distribution[item.index].percentage++;
      missing--;
    }
  }
  const recent = ['本周', '上周', '2 周前', '3 周前'].map((name, index) => {
    const start = shiftDay(currentWeekStart, -7 * index);
    const end = index === 0 ? today : shiftDay(start, 6);
    return { name, start, end, totalMs: sumRecords(inRange(usable, { start, end })).totalMs };
  });
  const largestWeek = Math.max(0, ...recent.map(week => week.totalMs));
  const rangeName = state.range === 'today' ? '今日' : state.range === 'week' ? '本周' : `${year} 年 ${month} 月`;
  return {
    today, currentMonth, selectedMonth, range: state.range, analysis, analysisLabel: `${rangeName} · ${dateSpan(analysis)}`,
    analysisTotals, todayMs: sumRecords(inRange(usable, { start: today, end: today })).totalMs,
    weekMs: sumRecords(inRange(usable, { start: currentWeekStart, end: today })).totalMs,
    streak: focusStreak(usable, today),
    trendTitle: state.range === 'today' ? '今日分类时长' : state.range === 'month' ? '月内每周趋势' : '最近 7 天趋势',
    trendCaption: state.range === 'week' ? `${dateSpan(rolling)} · 含过去 7 个自然日`
      : state.range === 'month' ? `${dateSpan({ start: weeks[0].start, end: weeks.at(-1)!.end })} · 首尾周仅含当月日期${selectedMonth === currentMonth ? '，未到日期显示 0' : ''}`
      : `${dateSpan(analysis)} · 按类别查看`,
    buckets, categories, distribution,
    recentWeeks: recent.map(week => ({ ...week, share: largestWeek ? week.totalMs / largestWeek : 0 })),
    growth: progress(records),
  };
}
