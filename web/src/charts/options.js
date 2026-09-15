/**
 * options.js —— 每个统计口径对应一个 option 构造函数。
 *
 * 全部写成**纯函数**（数据进、option 出，不碰 echarts 实例、不碰 DOM）。
 * 这样验收脚本可以直接 import 进来断言"某口径喂进去，series 里有几个点"，
 * 不用去截图里数像素。改图先改这里，再改组件。
 *
 * 两条贯穿全文件的用色规则（新增图表请照做）：
 *   1. **排序类**（横向排行、漏斗这类"名次即语义"的图）用**明度阶梯**：
 *      第一名最深，往后逐级变浅。看长度定大小，看深浅定名次。
 *   2. **黄色 #ffcb00 每张图只出现一次**，标记该图**最关键的那一项**。
 *      这是规范里「黄只做 ≤1% 面积的点缀」在图表上的落地方式，
 *      不是"再挑一个系列上色"。
 */

import { PP, SERIES, HEAT_RAMP, HEAT_EMPTY, valueAxis, categoryAxis, grid } from './theme.js';
import { mdText } from '../utils.js';

const n = (v) => Number(v || 0);

/** 明度阶梯：按名次从深到浅，专给"排序类"图表用 */
const LADDER = ['#0f68ea', '#2f7ceb', '#6ba3ee', '#9cc1f2', '#c5daf7', '#dbe8fa', '#e9f1fc'];
const ladderAt = (i) => LADDER[Math.min(i, LADDER.length - 1)];

const baseTooltip = (extra = {}) => ({
  trigger: 'axis',
  axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(15, 104, 234, 0.05)' } },
  ...extra,
});

/** 空数据统一给一个能正常渲染的空图，避免组件里到处 v-if */
const EMPTY_TEXT = '暂无数据';
const emptyGraphic = {
  type: 'text',
  left: 'center',
  top: 'middle',
  style: { text: EMPTY_TEXT, fill: PP.graySoft, fontSize: 13, fontFamily: PP.font },
};

const has = (arr) => Array.isArray(arr) && arr.length > 0;

// ============================================================ 1. 七天趋势

/**
 * 七天趋势：柱=打卡次数（主指标），线=参与人数，虚线=提交批次。
 * 三条的量纲完全不同（次数可以上万，人数一千级，批次几百），
 * 所以拆左右两个 Y 轴 —— 挤在一个轴上会把人数压成贴着底的一条直线。
 *
 * isToday 的那一天用一条虚线标出来，让"活动进行到第几天"一眼可见。
 */
export function trendOption(trend = []) {
  if (!has(trend)) return { graphic: emptyGraphic };
  const dates = trend.map((d) => mdText(d.date));
  const todayIdx = trend.findIndex((d) => d.isToday);

  return {
    tooltip: baseTooltip(),
    legend: { data: ['打卡次数', '参与人数', '提交批次'], top: 0, right: 0 },
    grid: grid({ top: 44, bottom: 4 }),
    xAxis: categoryAxis(dates),
    yAxis: [
      { ...valueAxis, name: '次', nameTextStyle: { color: PP.gray, fontSize: 11 } },
      {
        ...valueAxis,
        name: '人 / 批',
        nameTextStyle: { color: PP.gray, fontSize: 11 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '打卡次数',
        type: 'bar',
        data: trend.map((d) => n(d.checkins)),
        itemStyle: { color: PP.blue, borderRadius: [100, 100, 0, 0] },
        barMaxWidth: 26,
        markLine: todayIdx >= 0
          ? {
              silent: true,
              symbol: 'none',
              lineStyle: { color: PP.graySoft, type: 'dashed', width: 1 },
              label: {
                formatter: '今天',
                color: PP.slate,
                fontSize: 11,
                fontFamily: PP.font,
                position: 'insideEndTop',
              },
              data: [{ xAxis: todayIdx }],
            }
          : undefined,
      },
      {
        name: '参与人数',
        type: 'line',
        yAxisIndex: 1,
        data: trend.map((d) => n(d.people)),
        itemStyle: { color: PP.navy },
        lineStyle: { width: 2, color: PP.navy },
        symbolSize: 6,
      },
      {
        name: '提交批次',
        type: 'line',
        yAxisIndex: 1,
        data: trend.map((d) => n(d.batches)),
        itemStyle: { color: PP.yellow },
        lineStyle: { width: 2, type: 'dashed', color: PP.yellow },
        symbolSize: 5,
      },
    ],
  };
}

// ====================================================== 2. 日期 × 主题热力

/**
 * 日期 × 主题 热力图。
 *
 * 必须用 **piecewise（离散分档）** 而不是连续 visualMap ——
 * 连续 visualMap 会在色阶之间插值，等于在界面里画了一条渐变，
 * 撞规范里「任何地方都不许出现渐变」。
 * 离散分档还有个附带好处：图例直接写出"几到几次"，不用读色条。
 */
export function heatmapOption(matrix) {
  const dates = matrix?.dates || [];
  const themes = matrix?.themes || [];
  const cells = matrix?.cells || [];
  if (!dates.length || !themes.length) return { graphic: emptyGraphic };

  const max = Math.max(1, n(matrix.maxCell));
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const themeIndex = new Map(themes.map((t, i) => [t, i]));

  const data = cells.map((c) => [dateIndex.get(c.date), themeIndex.get(c.theme), n(c.count)]);

  // 分成最多 5 档，档位标签写成 "1–8" 这种人话
  const buckets = Math.min(5, max);
  const step = Math.ceil(max / buckets);
  const pieces = [{ value: 0, color: HEAT_EMPTY, label: '0' }];
  for (let i = 0; i < buckets; i += 1) {
    const lo = i * step + 1;
    const hi = Math.min(max, (i + 1) * step);
    if (lo > max) break;
    pieces.push({
      min: lo,
      max: hi,
      color: HEAT_RAMP[Math.min(2 + i, HEAT_RAMP.length - 1)],
      label: lo === hi ? String(lo) : `${lo}–${hi}`,
    });
  }

  return {
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        // 悬停到 visualMap 的分档图例时 p.value 不是 [x, y, v]，
        // 直接下标会拿到 undefined 并抛错，所以先挡一道
        if (!Array.isArray(p.value) || p.value.length < 3) return '';
        const d = dates[p.value[0]];
        const t = themes[p.value[1]];
        return `${mdText(d)} · ${t}<br/><b>${p.value[2]}</b> 次`;
      },
    },
    grid: grid({ top: 8, bottom: 48, left: 8, right: 12 }),
    xAxis: {
      ...categoryAxis(dates.map((d) => mdText(d)), { splitArea: { show: false } }),
      axisLine: { show: false },
    },
    yAxis: { ...categoryAxis(themes), axisLine: { show: false } },
    visualMap: {
      type: 'piecewise',
      pieces,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 14,
      itemHeight: 12,
      itemGap: 6,
      textStyle: { color: PP.slate, fontSize: 11, fontFamily: PP.font },
    },
    series: [
      {
        type: 'heatmap',
        data,
        label: {
          show: true,
          fontSize: 12,
          fontFamily: PP.font,
          // 深色格子上换白字，不然蓝底蓝字读不出来
          color: PP.ink,
          formatter: (p) => (p.value[2] ? p.value[2] : ''),
        },
        itemStyle: { borderColor: PP.white, borderWidth: 2, borderRadius: 8 },
        emphasis: { itemStyle: { borderColor: PP.ink, borderWidth: 2 } },
      },
    ],
  };
}

// ========================================================== 3. 七主题雷达

/**
 * 七主题雷达：一眼看出活动在哪个主题上"塌"了。
 * 单系列单色 —— 雷达面积本身就是可读的，再上七种色相会让这张图
 * 变成活动页配色展示，反而看不出哪块凹。
 */
export function themeRadarOption(matrix) {
  const byTheme = matrix?.byTheme || [];
  if (!has(byTheme)) return { graphic: emptyGraphic };

  const max = Math.max(1, ...byTheme.map((t) => n(t.count)));
  // 雷达外圈留一点余量，否则最大值会顶到轴上
  const bound = Math.ceil(max * 1.15);

  return {
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const rows = byTheme
          .map((t, i) => `${t.theme}：<b>${n(t.count)}</b> 次`)
          .join('<br/>');
        return `各主题累计次数<br/>${rows}`;
      },
    },
    radar: {
      indicator: byTheme.map((t) => ({ name: t.theme, max: bound })),
      radius: '68%',
      center: ['50%', '54%'],
    },
    series: [
      {
        type: 'radar',
        data: [{ value: byTheme.map((t) => n(t.count)), name: '累计次数' }],
        areaStyle: { color: 'rgba(15, 104, 234, 0.12)' },
        lineStyle: { color: PP.blue, width: 2 },
        itemStyle: { color: PP.blue },
        symbolSize: 5,
      },
    ],
  };
}

// ================================================== 4. 当日七项任务完成度

/**
 * 当日七项任务的完成人数排行（横向柱）。
 * 排序类 → 走明度阶梯，第一名最深。
 * 线下打卡点用虚化 ＋ 括号标注，因为它的数值天然偏低（要去现场），
 * 不标出来会被误读成"这个主题活动方没推"。
 */
export function dailyTaskOption(daily) {
  const tasks = daily?.tasks || [];
  if (!has(tasks)) return { graphic: emptyGraphic };

  // 横向柱的类目轴是从下往上排的，倒序之后第一名才在顶上
  const list = [...tasks].reverse();
  const max = Math.max(1, ...list.map((t) => n(t.people)));

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(15, 104, 234, 0.05)' } },
      formatter: (ps) => {
        const p = ps[0];
        const t = list[p.dataIndex];
        const offline = t.isOffline ? `<br/>线下打卡点：${t.offlinePoint || '—'}` : '';
        return `${t.theme} · ${t.taskName}<br/><b>${n(t.people)}</b> 人 · ${n(t.count)} 次${offline}`;
      },
    },
    grid: grid({ top: 8, bottom: 4, left: 8, right: 40 }),
    xAxis: { ...valueAxis, max, splitLine: { show: false } },
    yAxis: {
      ...categoryAxis(list.map((t) => `${t.theme}｜${t.taskName.slice(0, 8)}`)),
      axisLabel: { ...categoryAxis([]).axisLabel, width: 130, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        // 名次从深到浅：reverse 之后索引 0 是最后一名，所以倒着取阶梯
        data: list.map((t, i) => ({
          value: n(t.people),
          itemStyle: {
            color: t.isOffline ? PP.graySoft : ladderAt(list.length - 1 - i),
            borderRadius: 100,
          },
        })),
        barMaxWidth: 18,
        label: {
          show: true,
          position: 'right',
          color: PP.slate,
          fontSize: 12,
          fontFamily: PP.font,
          formatter: (p) => {
            const t = list[p.dataIndex];
            return t.isOffline ? `${p.value} 人 (线下)` : `${p.value} 人`;
          },
        },
      },
    ],
  };
}

// ==================================================== 5. 打卡天数分布

/**
 * 打卡天数分布：坚持了 1～7 天的人各有多少。
 * 用途是判断活动粘性 —— 打满全程的人占了多大比例。
 * 满勤那一根给黄色：它是活动方唯一真正想要的数字，也是全图的关键项。
 */
export function dayDistOption(dist = [], fullDays = 7) {
  if (!has(dist)) return { graphic: emptyGraphic };

  return {
    tooltip: baseTooltip({
      formatter: (ps) => {
        const p = ps[0];
        return `坚持 <b>${dist[p.dataIndex].days}</b> 天<br/><b>${n(p.value)}</b> 人`;
      },
    }),
    grid: grid({ top: 24, bottom: 4 }),
    xAxis: categoryAxis(dist.map((d) => `${d.days} 天`)),
    yAxis: valueAxis,
    series: [
      {
        type: 'bar',
        data: dist.map((d) => ({
          value: n(d.people),
          itemStyle: {
            color: d.days >= fullDays ? PP.yellow : PP.blue,
            borderRadius: [100, 100, 0, 0],
          },
        })),
        barMaxWidth: 42,
        label: {
          show: true,
          position: 'top',
          color: PP.slate,
          fontSize: 12,
          fontFamily: PP.font,
        },
      },
    ],
  };
}

// ==================================================== 6. 主题覆盖分布

/**
 * 主题覆盖分布：覆盖了 0～7 个主题的人各有多少。
 * 覆盖 7 个主题 = 全能少年候选，所以最后一根给黄色。
 * 注意用 yAxis 而不是 xAxis 收 0 值 —— 5 个主题以上才是有意义的区间。
 */
export function themeCoverageOption(cover = []) {
  if (!has(cover)) return { graphic: emptyGraphic };

  return {
    tooltip: baseTooltip({
      formatter: (ps) => {
        const p = ps[0];
        return `覆盖 <b>${cover[p.dataIndex].themes}</b> 个主题<br/><b>${n(p.value)}</b> 人`;
      },
    }),
    grid: grid({ top: 24, bottom: 4 }),
    xAxis: categoryAxis(cover.map((c) => `${c.themes} 个`)),
    yAxis: valueAxis,
    series: [
      {
        type: 'bar',
        data: cover.map((c) => ({
          value: n(c.people),
          itemStyle: {
            color: c.themes >= 7 ? PP.yellow : PP.blue,
            borderRadius: [100, 100, 0, 0],
          },
        })),
        barMaxWidth: 42,
        label: { show: true, position: 'top', color: PP.slate, fontSize: 12, fontFamily: PP.font },
      },
    ],
  };
}

// ====================================================== 7. 学校排行

/** 学校排行（横向柱 Top 10）。排序类 → 明度阶梯。 */
export function schoolRankOption(schools = [], top = 10) {
  if (!has(schools)) return { graphic: emptyGraphic };

  const list = [...schools].slice(0, top).reverse();

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(15, 104, 234, 0.05)' } },
      formatter: (ps) => {
        const s = list[ps[0].dataIndex];
        return `${s.school}<br/><b>${n(s.checkins)}</b> 次 · ${n(s.people)} 人<br/>人均 ${s.avgPerPerson} 次`;
      },
    },
    grid: grid({ top: 8, bottom: 4, left: 8, right: 44 }),
    xAxis: { ...valueAxis, splitLine: { show: false } },
    yAxis: {
      ...categoryAxis(list.map((s) => s.school)),
      axisLabel: { ...categoryAxis([]).axisLabel, width: 150, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        data: list.map((s, i) => ({
          value: n(s.checkins),
          itemStyle: { color: ladderAt(list.length - 1 - i), borderRadius: 100 },
        })),
        barMaxWidth: 16,
        label: {
          show: true,
          position: 'right',
          color: PP.slate,
          fontSize: 12,
          fontFamily: PP.font,
        },
      },
    ],
  };
}

// ====================================================== 8. 参与漏斗

/**
 * 参与漏斗：登记 → 打过卡 → 坚持 3 天 → 满勤。
 * 同色相明度阶梯（上深下浅），因为四层是"同一件事的四个阶段"，
 * 不是四个并列的类别 —— 这种情况用四种色相是错的。
 */
export function funnelOption(funnel) {
  const stages = funnel?.stages || [];
  if (!has(stages)) return { graphic: emptyGraphic };

  const tones = ['#0f68ea', '#2f7ceb', '#6ba3ee', '#9cc1f2'];

  return {
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const s = stages[p.dataIndex];
        if (!s) return '';
        return `${s.name}<br/><b>${n(s.people)}</b> 人<br/>占登记 ${s.rateFromTop}% · 上一层留存 ${s.rateFromPrev}%`;
      },
    },
    series: [
      {
        type: 'funnel',
        left: 12,
        right: 12,
        top: 16,
        bottom: 16,
        minSize: '28%',
        gap: 4,
        sort: 'descending',
        data: stages.map((s, i) => ({
          name: s.name,
          value: n(s.people),
          itemStyle: { color: tones[Math.min(i, tones.length - 1)], borderRadius: 8 },
        })),
        label: {
          position: 'inside',
          color: PP.white,
          fontSize: 13,
          fontFamily: PP.font,
          formatter: (p) => `${p.name}  ${p.value} 人`,
        },
        labelLine: { show: false },
      },
    ],
  };
}

// ====================================================== 9. 荣誉达标环形

/**
 * 荣誉达标环形图。
 * 三个荣誉是并列类别，用蓝 / 深蓝 / 黄 三档区分 —— 黄落在
 * "主题之星"上，因为它是三类里唯一按「颗」计的（一人可多颗），
 * 最容易和人数混淆，值得一个视觉提示。
 */
export function honorDonutOption(honors) {
  const list = honors?.honors || [];
  if (!has(list) || list.every((h) => n(h.count) === 0)) return { graphic: emptyGraphic };

  const tones = { allThemes: PP.blue, dakaMaster: PP.navy, themeStar: PP.yellow };
  const total = list.reduce((s, h) => s + n(h.count), 0);

  return {
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const h = list[p.dataIndex];
        if (!h) return '';
        return `${h.name}<br/><b>${n(h.count)}</b> ${h.unit}<br/>${h.rule}`;
      },
    },
    legend: { bottom: 0, left: 'center', icon: 'roundRect' },
    series: [
      {
        type: 'pie',
        radius: ['52%', '74%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        data: list.map((h) => ({
          name: h.name,
          value: n(h.count),
          itemStyle: { color: tones[h.key] || PP.blue },
        })),
        label: {
          show: true,
          formatter: '{b}\n{c}',
          color: PP.slate,
          fontSize: 12,
          lineHeight: 18,
          fontFamily: PP.font,
        },
        labelLine: { length: 10, length2: 12, lineStyle: { color: PP.fog } },
        emphasis: { scale: false },
      },
    ],
    graphic: [
      {
        type: 'text',
        left: 'center',
        top: '38%',
        style: {
          text: String(total),
          fill: PP.ink,
          fontSize: 30,
          fontWeight: 700,
          fontFamily: PP.font,
          align: 'center',
        },
      },
      {
        type: 'text',
        left: 'center',
        top: '48%',
        style: {
          text: '达标合计',
          fill: PP.slate,
          fontSize: 12,
          fontFamily: PP.font,
          align: 'center',
        },
      },
    ],
  };
}

// ==================================================== 10. 提交时段分布

/**
 * 提交时段分布：家长在几点提交。
 * 峰值那一根给黄色 —— 它就是这张图唯一的结论（提醒该几点发）。
 * 空档时段同样重要：0-5 点有人打卡说明作息问题，图里一眼能看见。
 */
export function hourlyOption(hourly) {
  const hours = hourly?.hours || [];
  if (!has(hours) || hours.every((h) => n(h.batches) === 0)) return { graphic: emptyGraphic };

  const peak = hourly.peakHour;

  return {
    tooltip: baseTooltip({
      formatter: (ps) => {
        const p = ps[0];
        return `<b>${hours[p.dataIndex].label}</b> 前后<br/><b>${n(p.value)}</b> 次提交`;
      },
    }),
    grid: grid({ top: 24, bottom: 4 }),
    xAxis: categoryAxis(hours.map((h) => String(h.hour).padStart(2, '0')), {
      // 24 个刻度全写出来会糊成一片，隔一个显示
      axisLabel: {
        color: PP.slate,
        fontSize: 11,
        fontFamily: PP.font,
        interval: 1,
      },
    }),
    yAxis: valueAxis,
    series: [
      {
        type: 'bar',
        data: hours.map((h) => ({
          value: n(h.batches),
          itemStyle: {
            color: h.hour === peak ? PP.yellow : PP.blue,
            borderRadius: [100, 100, 0, 0],
          },
        })),
        barMaxWidth: 16,
      },
    ],
  };
}

export { SERIES, LADDER };
