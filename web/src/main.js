import { createApp } from 'vue';
import App from './App.vue';
import router from './router.js';
import { setUnauthorizedHandler } from './api.js';
import { logoutParticipant, loadHealth } from './appstate.js';

import './styles/base.css';
import './styles/outseta.css';
// 后台皮肤（antd-planpoint.css）必须全局引入：
// /admin 未登录会跳到 /admin/login，那是独立路由、不依赖 AdminLayout，
// 不会去 import admin-ui.js，若只在 admin-ui.js 里引这份 CSS，登录页就会整页裸奔。
// 这里只引 CSS 文件（不引 admin-ui.js），家长端 H5 不会下载 a-v 的 JS 库，仍保持懒加载。
import './styles/antd-planpoint.css';

const app = createApp(App);

/**
 * token 失效时统一处理：
 * 后台 → 回登录页；参与者 → 清掉本地态并引导重新登记。
 * 放在这里而不是 api.js 里，是为了不让接口层依赖路由。
 */
setUnauthorizedHandler((who) => {
  if (who === 'admin') {
    if (!location.pathname.startsWith('/admin/login')) {
      router.replace({ name: 'admin-login', query: { redirect: location.pathname } });
    }
  } else {
    logoutParticipant();
  }
});

app.use(router);
app.mount('#app');

// 不 await：横幅是锦上添花，首屏不该等它
loadHealth();
