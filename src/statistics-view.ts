import { catDisplayName } from './cat-names';
import { icon, categoryIcon } from './category-icons';
import { catSequence, type CatDefinition } from './cat-definition';
import { buildStatistics, chartScale, dateSpan, formatStatDuration, type StatisticsModel, type StatisticsState, type TrendBucket } from './statistics';
import type { FocusRecord } from './domain';
import type { FocusCategory } from './categories';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const percent = (share: number) => `${Math.max(0, Math.min(100, share * 100))}%`;

function bucketDescription(bucket: TrendBucket, model: StatisticsModel) {
  const parts = model.categories.filter(category => (bucket.byCategory.get(category.id) || 0) > 0)
    .map(category => `${category.name} ${formatStatDuration(bucket.byCategory.get(category.id) || 0)}`);
  return `${bucket.description}，总计 ${formatStatDuration(bucket.totalMs)}${parts.length ? `；${parts.join('，')}` : '；暂无记录'}`;
}

function renderChart(model: StatisticsModel, state: StatisticsState) {
  const width = 340, height = 205, left = 35, right = 8, top = 12, baseline = 160;
  const plotWidth = width - left - right, plotHeight = baseline - top;
  const scale = chartScale(Math.max(0, ...model.buckets.map(bucket => bucket.totalMs / 60_000)));
  const slot = plotWidth / model.buckets.length;
  const barWidth = Math.min(27, slot * .62);
  const grid = scale.ticks.map(tick => {
    const y = baseline - tick / scale.maximum * plotHeight;
    return `<line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" class="stats-grid-line"/><text x="${left - 8}" y="${y + 3}" text-anchor="end" class="stats-axis">${tick}</text>`;
  }).join('');
  const columns = model.buckets.map((bucket, index) => {
    const center = left + slot * (index + .5), x = center - barWidth / 2;
    const totalHeight = bucket.totalMs / 60_000 / scale.maximum * plotHeight;
    let stacked = 0;
    const segments = model.categories.map(category => {
      const milliseconds = bucket.byCategory.get(category.id) || 0;
      const segmentHeight = milliseconds / 60_000 / scale.maximum * plotHeight;
      const y = baseline - stacked - segmentHeight;
      stacked += segmentHeight;
      return milliseconds ? `<rect data-chart-category="${escape(category.id)}" data-milliseconds="${milliseconds}" x="${x}" y="${y}" width="${barWidth}" height="${segmentHeight}" fill="${category.color}"/>` : '';
    }).join('');
    return `<g class="stats-chart-column" role="button" tabindex="0" data-stats-bucket="${escape(bucket.id)}" aria-pressed="${state.selectedBucket === bucket.id}" aria-label="${escape(bucketDescription(bucket, model))}"><title>${escape(bucketDescription(bucket, model))}</title>
      <rect class="stats-column-hit" x="${left + slot * index + 1}" y="${top}" width="${slot - 2}" height="${plotHeight}" rx="8"/>
      <clipPath id="stats-clip-${index}"><rect x="${x}" y="${baseline - totalHeight}" width="${barWidth}" height="${totalHeight}" rx="4"/></clipPath><g clip-path="url(#stats-clip-${index})">${segments}</g>
      ${!bucket.totalMs ? `<text x="${center}" y="${baseline - 7}" text-anchor="middle" class="stats-zero">0</text>` : ''}
      <text x="${center}" y="181" text-anchor="middle" class="stats-axis">${escape(bucket.label)}</text><text x="${center}" y="197" text-anchor="middle" class="stats-axis">${escape(bucket.secondary)}</text></g>`;
  }).join('');
  return `<span class="stats-chart-unit">分钟</span><svg class="stats-chart" viewBox="0 0 ${width} ${height}" role="group" aria-labelledby="stats-chart-title stats-chart-description"><title id="stats-chart-title">${model.trendTitle}</title><desc id="stats-chart-description">堆叠柱表示各类别的有效专注时长。零记录显示为零。点击柱子或用 Tab 与回车查看明细。</desc>${grid}<line x1="${left}" x2="${width - right}" y1="${baseline}" y2="${baseline}" class="stats-baseline"/>${columns}</svg>`;
}

function renderDetail(model: StatisticsModel, state: StatisticsState) {
  const selected = model.buckets.find(bucket => bucket.id === state.selectedBucket);
  if (!selected) return '<p class="stats-chart-help">轻点柱子，查看时长与分类明细</p>';
  return `<div class="stats-bucket-detail" role="status"><div class="stats-detail-heading"><strong>${escape(selected.description)}</strong><span>${formatStatDuration(selected.totalMs)}</span></div><ul>${model.categories.filter(category => category.id.startsWith('builtin-') || (selected.byCategory.get(category.id) || 0) > 0).map(category => `<li style="--category-color:${category.color}"><span><i class="stats-dot"></i>${escape(category.name)}</span><b>${formatStatDuration(selected.byCategory.get(category.id) || 0)}</b></li>`).join('')}</ul></div>`;
}

export function renderStatistics(model: StatisticsModel, state: StatisticsState, companion: CatDefinition | null = null, coinBalance = 0): string {
  const growth = model.growth;
  const trendTotal = model.buckets.reduce((sum, bucket) => sum + bucket.totalMs, 0);
  return `<div class="stats-page">
    <header class="stats-header"><div><div class="eyebrow">积累看得见</div><h1>专注统计</h1><p>先看结果，再看趋势。</p></div>${companion ? `<img src="${catSequence(companion, 'sleep_loop').frames[0].file}" class="stats-header-cat" alt="${escape(catDisplayName(companion))}"/>` : ''}</header>
    <div class="stats-range-switch" role="group" aria-label="统计分析范围">${(['today', 'week', 'month'] as const).map((range, index) => `<button type="button" data-stats-range="${range}" aria-pressed="${state.range === range}">${['今日', '本周', '本月'][index]}</button>`).join('')}</div>
    ${state.range === 'month' ? `<label class="stats-month-picker">查看月份<input id="stats-month" type="month" min="1000-01" max="${model.currentMonth}" value="${model.selectedMonth}" aria-label="选择分析月份"/></label>` : ''}
    <section class="stats-metrics" aria-label="核心专注统计">
      <article class="stats-metric" data-stat="today" data-milliseconds="${model.todayMs}"><span class="stats-metric-icon">${icon('clock')}</span><span class="stats-metric-label">今日专注</span><strong>${formatStatDuration(model.todayMs)}</strong></article>
      <article class="stats-metric" data-stat="week" data-milliseconds="${model.weekMs}"><span class="stats-metric-icon">${icon('bars')}</span><span class="stats-metric-label">本周累计</span><strong>${formatStatDuration(model.weekMs)}</strong></article>
      <article class="stats-metric" data-stat="streak" title="每天有已保存且大于零的有效时长计一天；今天无记录时从昨天回溯"><span class="stats-metric-icon">${icon('flame')}</span><span class="stats-metric-label">连续专注</span><strong>${model.streak}<small> 天</small></strong></article>
    </section>
    ${model.range === 'today' ? `<section class="stats-card stats-growth" aria-labelledby="stats-growth-heading"><div class="stats-card-heading"><h2 id="stats-growth-heading">猫咪成长</h2><span class="stats-level">等级 ${growth.level}</span></div><div class="stats-growth-body">${companion ? `<img src="${companion.preview}" alt="${escape(catDisplayName(companion))}"/>` : '<span class="stats-unadopted">尚未领养</span>'}<div><p class="stats-growth-rewards"><span>${icon('star')}<span><strong>${growth.experience}</strong> 经验</span></span><span>${icon('paw-coin')}<span><strong>${coinBalance}</strong> 猫爪币</span></span></p><progress aria-label="距下一级的经验进度" max="${growth.next - growth.current}" value="${growth.experience - growth.current}"></progress><small>距下一级还差 ${growth.next - growth.experience} 经验</small></div></div></section>` : `<section class="stats-card stats-trend" aria-labelledby="stats-trend-heading"><div class="stats-card-heading"><h2 id="stats-trend-heading">${model.trendTitle}</h2><span class="stats-trend-total">${formatStatDuration(trendTotal)}</span></div><p class="stats-caption">${model.trendCaption}</p>
      <ul class="stats-legend" aria-label="图表图例">${model.categories.map(category => `<li style="--category-color:${category.color}"><i class="stats-dot"></i>${escape(category.name)}</li>`).join('')}</ul>
      ${renderChart(model, state)}${!trendTotal ? '<p class="stats-empty">还没有专注记录，从一次小小的专注开始。</p>' : ''}${renderDetail(model, state)}
    </section>`}
    <section class="stats-card" aria-labelledby="stats-distribution-heading"><div class="stats-card-heading"><h2 id="stats-distribution-heading">分类分布</h2><span class="stats-analysis-total" data-milliseconds="${model.analysisTotals.totalMs}">${formatStatDuration(model.analysisTotals.totalMs)}</span></div><p class="stats-caption">${model.analysisLabel}</p>
      <div class="stats-distribution">${model.distribution.map(row => `<div class="stats-distribution-row" data-stats-category="${escape(row.id)}" data-milliseconds="${row.milliseconds}" style="--category-color:${row.color}"><span class="stats-category-icon">${categoryIcon(row.id, row.name)}</span><div class="stats-distribution-body"><div class="stats-distribution-label"><strong>${escape(row.name)}</strong><span>${formatStatDuration(row.milliseconds)}</span><b>${row.percentage}%</b></div><div class="stats-track" role="progressbar" aria-label="${escape(row.name)}占比" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${row.percentage}"><span style="width:${percent(row.share)}"></span></div></div></div>`).join('')}</div>
    </section>

    <section class="stats-card stats-weeks" aria-labelledby="stats-weeks-heading"><div class="stats-card-heading"><h2 id="stats-weeks-heading">近 4 周概览</h2></div><p class="stats-caption">周一开始 · 本周截至今日</p><div class="stats-week-list">${model.recentWeeks.map((week, index) => `<div class="stats-week" data-stats-week="${index}" data-milliseconds="${week.totalMs}"><div class="stats-week-period"><strong>${week.name}</strong><small title="${week.start} — ${week.end}">${dateSpan(week)}</small></div><div class="stats-track" aria-hidden="true" style="--category-color:${index % 2 ? '#f4bd62' : '#eb884b'}"><span style="width:${percent(week.share)}"></span></div><b>${formatStatDuration(week.totalMs)}</b></div>`).join('')}</div></section>
    <details class="stats-method"><summary>统计口径与连续天数</summary><p>仅统计已保存且大于零的有效专注时长，提前保存也计入；运行中或放弃的时长不计入。记录沿用保存时的本地结束日期，跨午夜不拆分。</p><p>每天有有效记录计一天，同一天多次只算一天；今天尚无记录时，从昨天回溯连续天数。此处统计的是专注天数。</p><p>本周分类统计从周一至今天；最近 7 天趋势包含今天及之前 6 天。月内趋势的首尾周只包含当月日期；近 4 周按完整自然周跨月统计，本周截至今天。</p><p>趋势与分类分布隐藏已停用类别，占比以当前可用类别合计计算。停用不删除历史记录；顶部累计、近4周概览和成长仍包含全部历史。时长按有效秒数累计，展示时取整分钟；有记录时，百分比取整后合计为 100%。</p></details>
  </div>`;
}

export function statisticsMarkup(records: FocusRecord[], categories: FocusCategory[], state: StatisticsState, now = new Date(), companion: CatDefinition | null = null, coinBalance = 0) {
  return renderStatistics(buildStatistics(records, categories, now, state), state, companion, coinBalance);
}

export function bindStatisticsEvents(container: HTMLElement, state: StatisticsState, rerender: () => void) {
  container.querySelectorAll<HTMLButtonElement>('[data-stats-range]').forEach(button => button.onclick = () => {
    const range = button.dataset.statsRange;
    if (range !== 'today' && range !== 'week' && range !== 'month') return;
    state.range = range; state.selectedBucket = null; rerender();
    container.querySelector<HTMLButtonElement>(`[data-stats-range="${range}"]`)?.focus();
  });
  container.querySelector<HTMLInputElement>('#stats-month')?.addEventListener('change', event => {
    const value = (event.target as HTMLInputElement).value;
    if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)) state.month = value;
    state.selectedBucket = null; rerender();
    container.querySelector<HTMLInputElement>('#stats-month')?.focus();
  });
  container.querySelectorAll<SVGElement | HTMLButtonElement>('[data-stats-bucket]').forEach(element => {
    const select = () => {
      const id = element.dataset.statsBucket!;
      state.selectedBucket = state.selectedBucket === id ? null : id;
      rerender();
      Array.from(container.querySelectorAll<SVGElement | HTMLButtonElement>('[data-stats-bucket]')).find(item => item.dataset.statsBucket === id)?.focus();
    };
    element.addEventListener('click', select);
    if (element instanceof SVGElement) element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
    });
  });
}

