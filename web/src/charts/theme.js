/**
 * theme.js —— ECharts 的 Planpoint 主题。
 *
 * 为什么需要单独一层：design/后台参考/DESIGN.md 是个房产蓝图站的规范，
 * 通篇没有一句讲图表。所以图表配色不能"照抄"，只能**从 Planpoint 的色板推导**。
 *
 * 推导出的三条铁律（改这里之前先读）：
 *   1. **只用明度阶梯，不引入新色相**。规范明令「不要引入额外的绿/紫/红」，
 *      所以多系列区分靠 蓝→深蓝→黄→灰 的明度差，不靠色相轮。
 *   2. **不用渐变**。规范写死「系统内任何地方都不许出现渐变」，
 *      折线不加渐变面积、柱子不加渐变底、热力图也必须用离散色阶（不是连续渐变）。
 *   3. **不出现纯黑**。正文与轴线一律 #1d1d1f / #333333，
 *      纯黑只允许出现在导航边框那个特例（规范里 carbon 的用法）。
 *
 * 圆角同样受规范约束：Planpoint 只允许 46.8 / 28.8 / 100 / 18 四档，
 * 所以数据条一律走 100（药丸端头），提示框走 18（输入框那档）。
 */

export const PP = {
  ink: '#1d1d1f',
  slate: '#333333',
  fog: '#e5e6e8',
  mist: '#f0f2f4',
  white: '#ffffff',

  // 唯一的彩色动作色，也是系列 1
  blue: '#0f68ea',
  // 同色相的三级明度，用于第三、第六系列
  blueSoft: '#85b7eb',
  blueFaint: '#cfe0f8',
  // 深面，系列 2
  navy: '#000a3b',
  // 系统里唯一的暖色，系列 3 / 峰值强调
  yellow: '#ffcb00',

  // 灰阶三级
  gray: '#888780',
  graySoft: '#b4b2a9',
  grayFaint: '#d3d1c7',

  font: "'Inter', ui-sans-serif, system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  shadow: 'rgba(0, 0, 0, 0.06) 0px 8px 48px 0px',
};

/**
 * 系列色顺序 —— 按「重要程度」排，不是按色相排。
 * 系列 1 永远是当前/主指标，系列 2 是对比项，系列 3 才是强调点。
 */
export const SERIES = [PP.blue, PP.navy, PP.yellow, PP.blueSoft, PP.gray, PP.blueFaint, PP.graySoft];

/**
 * 热力图色阶（离散，不是渐变）。
 * 从「几乎空白」到「最热」全部落在蓝色色相内，
 * 对应规范里「surfaces 层级 #ffffff → #f0f2f4 → #0f68ea」那条栈。
 */
export const HEAT_RAMP = ['#f7f8f9', '#e3edfb', '#c5daf7', '#9cc1f2', '#6ba3ee', '#2f7ceb', '#0f68ea', '#0a4a9e'];

/** 灰底上的「暂无数据」单元格，和热力图 0 值区分开 */
export const HEAT_EMPTY = '#f7f8f9';

// ---------------------------------------------------------------- 公共片段

const axisLabel = { color: PP.slate, fontSize: 12, fontFamily: PP.font };
const axisLine = { lineStyle: { color: PP.fog, width: 1 } };

const splitLine = {
  show: true,
  lineStyle: { color: PP.mist, width: 1, type: 'solid' },
};

const tooltip = {
  backgroundColor: PP.white,
  borderColor: PP.fog,
  borderWidth: 1,
  borderRadius: 18,
  padding: [10, 14],
  textStyle: { color: PP.ink, fontSize: 13, fontFamily: PP.font },
  extraCssText: `box-shadow: ${PP.shadow};`,
};

/** 数值类坐标轴（Y 轴 / 数值 X 轴） */
export const valueAxis = {
  type: 'value',
  axisLabel,
  axisLine: { show: false },
  axisTick: { show: false },
  splitLine,
};

/** 类目类坐标轴 */
export const categoryAxis = (data, extra = {}) => ({
  type: 'category',
  data,
  axisLabel,
  axisLine,
  axisTick: { show: false },
  splitLine: { show: false },
  ...extra,
});

/** 药丸端头的柱形 —— 这是 Planpoint 的药丸几何在数据条上的落地 */
export const pillBar = (color, horizontal = false) => ({
  color,
  borderRadius: horizontal ? 100 : [100, 100, 0, 0],
});

export const grid = (extra = {}) => ({
  left: 8,
  right: 12,
  top: 28,
  bottom: 4,
  containLabel: true,
  ...extra,
});

/**
 * ECharts 主题对象。
 * 注意：这里**不设 backgroundColor**，让图表透明、露出卡片的白色底 ——
 * 图表是卡片里的内容，不该是卡片里的第二张卡。
 */
export const planpointTheme = {
  color: SERIES,
  textStyle: { fontFamily: PP.font, color: PP.ink },
  title: {
    textStyle: { color: PP.ink, fontWeight: 600, fontFamily: PP.font },
    subtextStyle: { color: PP.slate, fontFamily: PP.font },
  },
  legend: {
    textStyle: { color: PP.slate, fontSize: 12, fontFamily: PP.font },
    itemWidth: 10,
    itemHeight: 10,
    itemGap: 16,
    icon: 'roundRect',
  },
  tooltip,
  grid: grid(),
  categoryAxis: { axisLabel, axisLine, axisTick: { show: false }, splitLine: { show: false } },
  valueAxis,
  line: {
    // 蓝图美学 = 精确，不做平滑曲线（平滑会让人误读未采样的中间值）
    smooth: false,
    symbol: 'circle',
    symbolSize: 6,
    lineStyle: { width: 2 },
  },
  bar: {
    // 柱子之间留一点白，蓝图排版感来自留白不是来自描边
    barMaxWidth: 28,
    itemStyle: { borderRadius: [100, 100, 0, 0] },
  },
  pie: {
    itemStyle: { borderColor: PP.white, borderWidth: 2 },
    label: { color: PP.ink, fontFamily: PP.font },
  },
  funnel: {
    label: { color: PP.ink, fontFamily: PP.font },
    itemStyle: { borderWidth: 0 },
  },
  radar: {
    axisName: { color: PP.slate, fontSize: 12, fontFamily: PP.font },
    splitLine: { lineStyle: { color: PP.fog } },
    splitArea: { areaStyle: { color: [PP.white, PP.white] } },
    axisLine: { lineStyle: { color: PP.fog } },
  },
};
