import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATEGORIES, type FocusCategory } from '../src/categories';
import { progress, type FocusRecord } from '../src/domain';
import { buildStatistics, chartScale, focusStreak, formatStatDuration, shiftDay, type AnalysisRange } from '../src/statistics';

const english = 'builtin-english', computer = 'builtin-computer';
const reading: FocusCategory = { id: 'custom-reading', name: '阅读', archived: false, order: 4 };
const catalogue = [...DEFAULT_CATEGORIES, reading];
let nextId = 0;
function record(day: string, minutes: number, categoryId = english): FocusRecord {
  const endedAt = `${day}T23:00:00.000+08:00`;
  return { id: `stats-record-${nextId++}`, categoryId, category: catalogue.find(item => item.id === categoryId)?.name || '自定义',
    mode: 'stopwatch', targetMinutes: null, completed: false, durationSeconds: minutes * 60,
    startedAt: new Date(Date.parse(endedAt) - minutes * 60_000).toISOString().replace('Z', '+00:00'), endedAt };
}
const now = () => new Date(2026, 9, 19, 15);
const build = (records: FocusRecord[], range: AnalysisRange = 'week', month = '2026-10', date = now()) =>
  buildStatistics(records, catalogue, date, { range, month, selectedBucket: null });
beforeEach(() => { vi.stubEnv('TZ', 'Asia/Shanghai'); });
afterEach(() => vi.unstubAllEnvs());

describe('statistics totals and category reconciliation', () => {
  it('uses calendar-week totals and a separate rolling seven-day trend with explicit zero days', () => {
    const records = [record('2026-10-13', 15), record('2026-10-18', 45, reading.id), record('2026-10-19', 60), record('2026-10-19', 30, computer)];
    const model = build(records);
    expect(model.todayMs).toBe(90 * 60_000);
    expect(model.weekMs).toBe(90 * 60_000);
    expect(model.analysis).toEqual({ start: '2026-10-19', end: '2026-10-19' });
    expect(model.buckets.map(bucket => bucket.start)).toEqual(['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19']);
    expect(model.buckets[1].totalMs).toBe(0);
    expect(model.buckets.reduce((sum, bucket) => sum + bucket.totalMs, 0)).toBe(150 * 60_000);
    expect(model.streak).toBe(2);
    expect(model.categories.some(category => category.id === reading.id)).toBe(true);
    expect(model.distribution.map(row => row.name)).toEqual(['英语', '计算机', '健身', '数学']);
  });

  it('includes active custom categories and reconciles their shares with the total', () => {
    const records = [record('2026-10-19', 1), record('2026-10-19', 1, computer), record('2026-10-19', 1, reading.id)];
    const model = build(records);
    expect(model.distribution.map(row => row.name)).toEqual(['英语', '计算机', '健身', '数学', '阅读']);
    expect(model.distribution.map(row => row.percentage)).toEqual([34, 33, 0, 0, 33]);
    expect(model.distribution.reduce((sum, row) => sum + row.milliseconds, 0)).toBe(model.analysisTotals.totalMs);
    expect(model.distribution.reduce((sum, row) => sum + row.percentage, 0)).toBe(100);
    expect(model.buckets.at(-1)!.totalMs).toBe(3 * 60_000);
    expect([...model.buckets.at(-1)!.byCategory.values()].reduce((sum, value) => sum + value, 0)).toBe(model.buckets.at(-1)!.totalMs);
  });

  it('hides disabled categories from every analysis range and restores them without losing history or growth', () => {
    const records = [record('2026-10-19', 10), record('2026-10-19', 20, computer), record('2026-10-19', 30, reading.id)];
    const archived = catalogue.map(category => ({ ...category, archived: category.id !== english }));
    for (const range of ['today', 'week', 'month'] as const) {
      const model = buildStatistics(records, archived, now(), { range, month: '2026-10', selectedBucket: null });
      expect(model.categories.map(category => category.id)).toEqual([english]);
      expect(model.distribution.map(row => row.percentage)).toEqual([100]);
      expect(model.analysisTotals.totalMs).toBe(10 * 60_000);
      expect(model.buckets.reduce((sum, bucket) => sum + bucket.totalMs, 0)).toBe(10 * 60_000);
      expect(model.todayMs).toBe(60 * 60_000);
      expect(model.weekMs).toBe(60 * 60_000);
      expect(model.recentWeeks[0].totalMs).toBe(60 * 60_000);
      expect(model.growth).toEqual(progress(records));
      const restored = build(records, range);
      expect(restored.analysisTotals.totalMs).toBe(60 * 60_000);
      expect(restored.categories.some(category => category.id === reading.id)).toBe(true);
    }
  });

  it('changes analysis without changing the core metrics or growth', () => {
    const records = [record('2026-09-30', 60), record('2026-10-01', 10, computer), record('2026-10-18', 30), record('2026-10-19', 20, reading.id)];
    const today = build(records, 'today'), week = build(records), month = build(records, 'month');
    expect(today.analysisTotals.totalMs).toBe(20 * 60_000);
    expect(week.analysisTotals.totalMs).toBe(20 * 60_000);
    expect(month.analysisTotals.totalMs).toBe(60 * 60_000);
    expect(month.buckets.reduce((sum, bucket) => sum + bucket.totalMs, 0)).toBe(month.analysisTotals.totalMs);
    expect(today.buckets.map(bucket => bucket.label)).toEqual(['英语', '计算机', '健身', '数学', '阅读']);
    for (const model of [today, week, month, build(records, 'month', '2026-09')]) {
      expect(model.todayMs).toBe(20 * 60_000);
      expect(model.weekMs).toBe(20 * 60_000);
      expect(model.streak).toBe(2);
      expect(model.growth).toEqual(progress(records));
    }
  });

  it('handles empty and single-category data without NaN or artificial percentages', () => {
    for (const range of ['today', 'week', 'month'] as const) {
      const empty = build([], range);
      expect(empty.distribution.map(row => row.percentage)).toEqual([0, 0, 0, 0]);
      expect(empty.buckets.every(bucket => bucket.totalMs === 0)).toBe(true);
      expect(empty.recentWeeks.every(week => week.share === 0)).toBe(true);
      expect(empty.streak).toBe(0);
    }
    const single = build([record('2026-10-19', 1, reading.id)]);
    expect(single.distribution.map(row => row.percentage)).toEqual([0, 0, 0, 0, 100]);
  });

  it('keeps millisecond fractions and the original growth calculation without mutating data', () => {
    const records = [record('2026-10-19', .5), record('2026-10-19', .5, computer)];
    const before = JSON.stringify({ records, catalogue });
    const model = build(records);
    expect(model.analysisTotals.totalMs).toBe(60_000);
    expect(model.growth.experience).toBe(1);
    expect(model.growth).toEqual(progress(records));
    expect(JSON.stringify({ records, catalogue })).toBe(before);
    expect(formatStatDuration(30_000)).toBe('少于 1 分钟');
    expect(formatStatDuration(0)).toBe('0 分钟');
    expect(formatStatDuration(85 * 60_000)).toBe('1 小时 25 分钟');
  });
});

describe('calendar boundaries', () => {
  it('uses the stored local end date rather than the UTC date or start date', () => {
    const sample = record('2026-10-19', 1);
    sample.startedAt = '2026-10-18T23:59:30.000+08:00';
    sample.endedAt = '2026-10-19T00:00:30.000+08:00';
    const model = build([sample]);
    expect(new Date(sample.endedAt).toISOString().slice(0, 10)).toBe('2026-10-18');
    expect(model.todayMs).toBe(60_000);
    expect(model.buckets.at(-1)!.totalMs).toBe(60_000);
    expect(model.buckets.at(-2)!.totalMs).toBe(0);
  });

  it('clips monthly edge weeks while the four-week overview crosses months', () => {
    const date = new Date(2026, 9, 2, 15);
    const records = [record('2026-09-28', 60), record('2026-10-01', 30), record('2026-10-03', 90)];
    const model = build(records, 'month', '2026-10', date);
    expect(model.buckets[0]).toMatchObject({ start: '2026-10-01', end: '2026-10-04', totalMs: 30 * 60_000 });
    expect(model.buckets.at(-1)).toMatchObject({ start: '2026-10-26', end: '2026-10-31', totalMs: 0 });
    expect(model.recentWeeks[0]).toMatchObject({ start: '2026-09-28', end: '2026-10-02', totalMs: 90 * 60_000, share: 1 });
    expect(model.recentWeeks[1]).toMatchObject({ start: '2026-09-21', end: '2026-09-27', totalMs: 0 });
    expect(model.weekMs).toBe(90 * 60_000);
    const previousMonth = build(records, 'month', '2026-09', date);
    expect(previousMonth.buckets.at(-1)).toMatchObject({ start: '2026-09-28', end: '2026-09-30', totalMs: 60 * 60_000 });
  });

  it('handles year boundaries, leap days and last-week dates', () => {
    const records = [record('2026-12-30', 20), record('2026-12-31', 30), record('2027-01-01', 40)];
    const model = build(records, 'week', '2027-01', new Date(2027, 0, 1, 15));
    expect(model.analysis).toEqual({ start: '2026-12-28', end: '2027-01-01' });
    expect(model.buckets[0].start).toBe('2026-12-26');
    expect(model.streak).toBe(3);
    expect(model.recentWeeks[0].totalMs).toBe(90 * 60_000);
    const leap = build([record('2024-02-29', 35)], 'month', '2024-02', new Date(2024, 2, 5, 15));
    expect(leap.buckets.at(-1)).toMatchObject({ start: '2024-02-26', end: '2024-02-29', totalMs: 35 * 60_000 });
    expect(shiftDay('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('steps by calendar dates across daylight saving changes', () => {
    vi.stubEnv('TZ', 'America/New_York');
    expect(shiftDay('2026-03-08', 1)).toBe('2026-03-09');
    expect(shiftDay('2026-11-01', 1)).toBe('2026-11-02');
    const model = build([record('2026-03-08', 1), record('2026-03-09', 1), record('2026-03-10', 1)], 'week', '2026-03', new Date(2026, 2, 10, 15));
    expect(new Set(model.buckets.map(bucket => bucket.start)).size).toBe(7);
    expect(model.streak).toBe(3);
  });

  it('counts distinct positive saved days, keeps yesterday streaks and resets after a gap', () => {
    const records = [record('2026-10-17', 1), record('2026-10-18', .01), record('2026-10-18', 2), record('2026-10-19', 0)];
    expect(focusStreak(records, '2026-10-19')).toBe(2);
    expect(focusStreak(records, '2026-10-20')).toBe(0);
    expect(focusStreak([...records, record('2026-10-19', 1)], '2026-10-19')).toBe(3);
  });

  it('uses one proportional scale for all four weeks and does not count future dates', () => {
    const model = build([record('2026-10-19', 20), record('2026-10-12', 40), record('2026-10-05', 10), record('2026-10-20', 100)]);
    expect(model.recentWeeks.map(week => week.share)).toEqual([.5, 1, .25, 0]);
    expect(model.todayMs).toBe(20 * 60_000);
    expect(model.weekMs).toBe(20 * 60_000);
  });
});

it('keeps chart scales finite, positive and above every plotted value', () => {
  for (const value of [0, .1, 3, 60, 179, 3800]) {
    const scale = chartScale(value);
    expect(Number.isFinite(scale.maximum)).toBe(true);
    expect(scale.maximum).toBeGreaterThan(0);
    expect(scale.maximum).toBeGreaterThanOrEqual(value);
    expect(scale.ticks[0]).toBe(0);
  }
});
