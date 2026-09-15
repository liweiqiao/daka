/**
 * echarts.js —— ECharts 的按需注册入口。
 *
 * 不引整包：后台虽然是懒加载，但图表全套组件加起来会多出几百 KB，
 * 而活动方实际用的图就那几种。这里显式列出用到的图表与组件，
 * **新增图表类型时记得回到这个文件补注册**，否则运行时只报
 * 「Component series.xxx not exists」这种看不出所以然的错。
 */

import * as echarts from 'echarts/core';

import {
  BarChart,
  LineChart,
  HeatmapChart,
  RadarChart,
  PieChart,
  FunnelChart,
} from 'echarts/charts';

import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
  DatasetComponent,
  MarkLineComponent,
  PolarComponent,
} from 'echarts/components';

import { CanvasRenderer } from 'echarts/renderers';
import { planpointTheme } from './theme.js';

echarts.use([
  BarChart,
  LineChart,
  HeatmapChart,
  RadarChart,
  PieChart,
  FunnelChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
  DatasetComponent,
  MarkLineComponent,
  PolarComponent,
  CanvasRenderer,
]);

const THEME_NAME = 'planpoint';
echarts.registerTheme(THEME_NAME, planpointTheme);

/** 全局统一用这一份 init，省得每个组件都传一遍主题名 */
export function initChart(el) {
  return echarts.init(el, THEME_NAME, { renderer: 'canvas' });
}

export { THEME_NAME };
export default echarts;
