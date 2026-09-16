import { createRouter, createWebHistory } from 'vue-router';
import { store as tokenStore } from './api.js';

/**
 * 路由分两块：
 *   /           参与者端（Outseta 皮肤，手机优先）
 *   /admin      统计后台（Planpoint 皮肤，桌面优先）
 * 后台用懒加载，家长手机上永远不会去下后台那几个 chunk。
 */

const routes = [
  { path: '/', name: 'home', component: () => import('./views/Home.vue'), meta: { title: '活动说明' } },
  { path: '/register', name: 'register', component: () => import('./views/Register.vue'), meta: { title: '登记信息' } },
  { path: '/checkin', name: 'checkin', component: () => import('./views/Checkin.vue'), meta: { title: '今日打卡' } },
  { path: '/records', name: 'records', component: () => import('./views/Records.vue'), meta: { title: '我的记录' } },

  { path: '/admin/login', name: 'admin-login', component: () => import('./views/admin/Login.vue'), meta: { title: '后台登录', bare: true } },
  {
    path: '/admin',
    component: () => import('./views/admin/AdminLayout.vue'),
    meta: { admin: true },
    children: [
      { path: '', redirect: '/admin/dashboard' },
      { path: 'dashboard', name: 'admin-dashboard', component: () => import('./views/admin/Dashboard.vue'), meta: { title: '总览' } },
      { path: 'checkins', name: 'admin-checkins', component: () => import('./views/admin/Checkins.vue'), meta: { title: '打卡明细' } },
      { path: 'participants', name: 'admin-participants', component: () => import('./views/admin/Participants.vue'), meta: { title: '参与者' } },
      { path: 'honors', name: 'admin-honors', component: () => import('./views/admin/Honors.vue'), meta: { title: '荣誉名单' } },
      { path: 'media', name: 'admin-media', component: () => import('./views/admin/Media.vue'), meta: { title: '附件与空间' } },
      { path: 'tasks', name: 'admin-tasks', component: () => import('./views/admin/Tasks.vue'), meta: { title: '任务字典' } },
      { path: 'settings', name: 'admin-settings', component: () => import('./views/admin/Settings.vue'), meta: { title: '活动设置' } },
    ],
  },

  { path: '/:pathMatch(.*)*', name: 'notfound', component: () => import('./views/NotFound.vue'), meta: { title: '页面不存在' } },
];

const router = createRouter({
  // BASE_URL 由 vite.config 的 base 决定：同源部署是 '/'，
  // GitHub Pages 等子路径部署（如 /daka/）时路由要跟着挂到子路径下
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, from, saved) {
    if (saved) return saved;
    return { top: 0 };
  },
});

router.beforeEach((to) => {
  if (to.meta.admin && !tokenStore.aToken) {
    return { name: 'admin-login', query: { redirect: to.fullPath } };
  }
  if (to.name === 'admin-login' && tokenStore.aToken) {
    return { name: 'admin-dashboard' };
  }
  return true;
});

router.afterEach((to) => {
  const base = '清城少年志 · 国庆打卡';
  document.title = to.meta.title ? `${to.meta.title} · ${base}` : base;
});

export default router;
