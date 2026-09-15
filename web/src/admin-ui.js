/**
 * admin-ui.js —— ant-design-vue 在后台这一侧的唯一切入点。
 *
 * ★ 为什么要单独一个模块，而不是在 main.js 里 import：
 *   后台路由是懒加载的，只要没人打开 /admin/*，Vite 就不会下载这个 chunk。
 *   如果放到 main.js，1500 个家长打开 H5 时会连带下载几百 KB 用不到的后台组件库。
 *   **所以不要把这个 import 挪到 main.js。**
 *
 * 这里做三件事：
 *   1. 引入 a-v 的 reset 与我们的 Planpoint 覆盖层（顺序不能反）
 *   2. 导出 ConfigProvider 的 token（能靠 token 改的就不写 CSS）
 *   3. 导出中文语言包，否则分页会显示 "10 / page"
 */

import 'ant-design-vue/dist/reset.css';
import './styles/antd-planpoint.css';

import zhCN from 'ant-design-vue/es/locale/zh_CN';
import { theme as antTheme } from 'ant-design-vue';

/** 与 planpoint.css 保持同一个字体栈，不然中英文会在两套字体间跳 */
const FONT = "'Inter', ui-sans-serif, system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

/** Planpoint 规范里允许的圆角，只有这四档 */
const R = { cards: 28.8, inputs: 18, pills: 100 };

export const ppTheme = {
  algorithm: antTheme.defaultAlgorithm,
  token: {
    // 配色：主色是唯一的彩色动作，正文用墨色不用纯黑
    colorPrimary: '#0f68ea',
    colorInfo: '#0f68ea',
    colorText: '#1d1d1f',
    colorTextSecondary: '#333333',
    colorTextTertiary: '#888780',
    colorTextQuaternary: '#b4b2a9',

    // 面与线
    colorBorder: '#e5e6e8',
    colorBorderSecondary: '#f0f2f4',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#ffffff',
    colorFillAlter: '#f0f2f4',
    colorFillSecondary: '#f0f2f4',

    // 唯一的阴影
    boxShadow: 'rgba(0, 0, 0, 0.06) 0px 8px 48px 0px',
    boxShadowSecondary: 'rgba(0, 0, 0, 0.06) 0px 8px 48px 0px',

    // 字与尺度
    fontFamily: FONT,
    fontSize: 14,
    borderRadius: R.inputs,
    borderRadiusLG: R.cards,
    borderRadiusSM: R.inputs,
    controlHeight: 40,
    controlHeightSM: 34,
    wireframe: false,
  },
  components: {
    Table: {
      headerBg: '#f0f2f4',
      headerColor: '#333333',
      // 表头分隔线在 Planpoint 里不存在，置成透明而不是靠 CSS 隐藏更稳
      headerSplitColor: 'transparent',
      headerBorderRadius: 0,
      rowHoverBg: '#fafbfc',
      borderColor: '#e5e6e8',
      cellPaddingBlock: 12,
      cellPaddingInline: 16,
      cellFontSize: 14,
      footerBg: '#ffffff',
    },
    Pagination: {
      borderRadius: R.pills,
      itemActiveBg: '#0f68ea',
    },
    Button: {
      borderRadius: R.pills,
      borderRadiusLG: R.pills,
      borderRadiusSM: R.pills,
      defaultBorderColor: '#1d1d1f',
      defaultColor: '#1d1d1f',
      primaryShadow: 'none',
      defaultShadow: 'none',
      dangerShadow: 'none',
    },
    Input: { borderRadius: R.inputs },
    InputNumber: { borderRadius: R.inputs },
    Select: { borderRadius: R.inputs, optionSelectedBg: 'rgba(15, 104, 234, 0.08)' },
    DatePicker: { borderRadius: R.inputs },
    Modal: { borderRadiusLG: R.cards, titleFontSize: 22 },
    Tag: { borderRadiusSM: R.pills, defaultBg: '#f0f2f4', defaultColor: '#333333' },
    Tooltip: { borderRadius: R.inputs, colorBgSpotlight: '#1d1d1f' },
    Popover: { borderRadiusLG: R.inputs },
    Message: { borderRadiusLG: R.inputs },
    // a-v 的 success/error 预设色在 Planpoint 里没有落点，收回到黄/蓝
    Alert: { colorInfoBg: '#f0f2f4', colorWarningBg: '#fff9e0' },
  },
};

export const ppLocale = zhCN;

export default { ppTheme, ppLocale };
