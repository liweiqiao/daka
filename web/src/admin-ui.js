/**
 * admin-ui.js —— ant-design-vue 在后台这一侧的唯一切入点。
 *
 * ★ 为什么要单独一个模块，而不是在 main.js 里 import：
 *   后台路由是懒加载的，只要没人打开 /admin/*，Vite 就不会下载这个 chunk。
 *   如果放到 main.js，1500 个家长打开 H5 时会连带下载几百 KB 用不到的后台组件库。
 *   **所以不要把这个 import 挪到 main.js。**
 *
 * 这里做三件事：
 *   1. 引入 a-v 的 reset 与我们的「蓝图白」覆盖层（顺序不能反）
 *   2. 导出 ConfigProvider 的 token（能靠 token 改的就不写 CSS）
 *   3. 导出中文语言包，否则分页会显示 "10 / page"
 *
 * 设计依据：design/后台参考/DESIGN.md（Planpoint 蓝图白规范）
 *   · 唯一彩色动作色是 #0f68ea；亮黄 #ffcb00 只做「需留意」徽章
 *   · 圆角只用 100（药丸）/ 28.8（卡片）/ 18（输入）三档
 *   · 唯一的阴影是 rgba(0,0,0,.06) 0 8px 48px，只给浮层（下拉/弹窗/提示）
 *   · 正文与图标一律 #1d1d1f，不用纯黑；系统内任何地方都不许渐变
 */

import 'ant-design-vue/dist/reset.css';
import './styles/antd-planpoint.css';

import zhCN from 'ant-design-vue/es/locale/zh_CN';
import { theme as antTheme } from 'ant-design-vue';

/** 与 antd-planpoint.css 保持同一个字体栈，不然中英文会在两套字体间跳 */
const FONT = "'Inter', ui-sans-serif, system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

/** 蓝图白规范允许的圆角，只有这三档（不新增） */
const R = { pill: 100, cards: 28.8, inputs: 18 };

export const ppTheme = {
  algorithm: antTheme.defaultAlgorithm,
  token: {
    // 配色：唯一彩色动作色是蓝图蓝 #0f68ea；正文用 #1d1d1f 不用纯黑；
    // 主操作按钮在 CSS 里用蓝图蓝填充（见 antd-planpoint.css）
    colorPrimary: '#0f68ea',
    colorInfo: '#0f68ea',
    colorLink: '#0f68ea',
    colorText: '#1d1d1f',
    colorTextSecondary: '#333333',
    colorTextTertiary: '#888780',
    colorTextQuaternary: '#b4b2a9',

    // 面与线：发丝线 #e5e6e8；容器白；雾灰 #f0f2f4 做浅底
    colorBorder: '#e5e6e8',
    colorBorderSecondary: '#e5e6e8',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#ffffff',
    colorFillAlter: '#f0f2f4',
    colorFillSecondary: '#f0f2f4',

    // 蓝图白：发丝线代替阴影；唯一的大阴影只留给浮层，token 这里给一个克制值
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
    boxShadowSecondary: '0 1px 2px rgba(0, 0, 0, 0.04)',

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
      // 表头分隔线在蓝图白里不存在，置成透明而不是靠 CSS 隐藏更稳
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
      borderRadius: R.pill,
      itemActiveBg: '#0f68ea',
    },
    Button: {
      borderRadius: R.pill,
      borderRadiusLG: R.pill,
      borderRadiusSM: R.pill,
      primaryShadow: 'none',
      defaultShadow: 'none',
      dangerShadow: 'none',
    },
    Input: { borderRadius: R.inputs },
    InputNumber: { borderRadius: R.inputs },
    InputPassword: { borderRadius: R.inputs },
    Select: { borderRadius: R.inputs, optionSelectedBg: 'rgba(15, 104, 234, 0.08)' },
    DatePicker: { borderRadius: R.inputs },
    Card: { borderRadiusLG: R.cards },
    Modal: { borderRadiusLG: R.cards, titleFontSize: 22 },
    Tag: { borderRadiusSM: R.pill, defaultBg: '#f0f2f4', defaultColor: '#333333' },
    Tooltip: { borderRadius: R.inputs, colorBgSpotlight: '#1d1d1f' },
    Popover: { borderRadiusLG: R.inputs },
    Message: { borderRadiusLG: R.inputs },
    Menu: {
      itemSelectedColor: '#0f68ea',
      itemSelectedBg: 'rgba(15, 104, 234, 0.08)',
      itemHoverBg: '#f0f2f4',
      itemActiveBg: '#f0f2f4',
      itemHeight: 44,
    },
    // a-v 的 success/error 预设色在蓝图白里没有落点，收回到雾灰 / 亮黄
    Alert: { colorInfoBg: '#f0f2f4', colorWarningBg: 'rgba(255, 203, 0, 0.12)' },
  },
};

export const ppLocale = zhCN;

export default { ppTheme, ppLocale };
