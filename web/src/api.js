/**
 * api.js —— 统一的接口层。
 *
 * 三件事在这里一次性解决，业务组件里就不用重复处理：
 *   1. token 注入：参与者与管理员各存一个键，互不干扰
 *   2. 统一拆包：后端固定返回 { ok, data } / { ok:false, code, message }，
 *      这里直接把 data 抛出去、把 message 作为 Error 抛出，组件只管 try/catch
 *   3. 401 自动登出：token 过期时清掉本地态并跳登录，而不是让页面一直转圈
 */

import { reactive } from 'vue';

const P_KEY = 'daka.p.token';
const A_KEY = 'daka.a.token';

/**
 * ★ token 同时存两处：localStorage（刷新/关页面不丢） + 一份响应式影子。
 *
 * 为什么必须有影子 —— 2026-09-16 实测踩到的坑：
 * 原先 store 的 getter 直接读 localStorage，而 localStorage 不是响应式的，
 * 于是 `computed(() => !!store.pToken)` 这个计算属性**一个依赖都没有**，
 * Vue 把第一次算出来的结果缓存后就再也不会重算。
 * 家长在打卡页就地填完三项 → token 已经写进 localStorage → 页面读到的还是
 * false → 不请求 /api/me/tasks → 表单消失、任务为空，看起来就是"登记了却进不去打卡页"。
 * isRegistered 更隐蔽：`!!token && !!state.me` 在没有 token 时短路，
 * 连 state.me 这个依赖都没登记上，同样被永久缓存成 false。
 *
 * 所以凡是要参与响应式的读取，都必须走这份 reactive 影子；
 * localStorage 只在模块初始化时读一次，之后由 setter 单向同步过去。
 */
const tokenState = reactive({
  p: (typeof localStorage !== 'undefined' && localStorage.getItem(P_KEY)) || '',
  a: (typeof localStorage !== 'undefined' && localStorage.getItem(A_KEY)) || '',
});

/**
 * 接口基地址。
 * 同源部署（dist 交给 Koa 托管）时留空 —— 所有 /api、/media 都是相对路径，天然同源；
 * 前后端分离部署（前端放 GitHub Pages 等静态托管）时，构建期注入
 * VITE_API_BASE（如 http://120.79.240.81:3010），所有请求改为打向后端。
 */
const API_BASE = import.meta.env.VITE_API_BASE || '';

export const store = {
  get pToken() { return tokenState.p; },
  set pToken(v) {
    tokenState.p = v || '';
    if (v) localStorage.setItem(P_KEY, v); else localStorage.removeItem(P_KEY);
  },
  get aToken() { return tokenState.a; },
  set aToken(v) {
    tokenState.a = v || '';
    if (v) localStorage.setItem(A_KEY, v); else localStorage.removeItem(A_KEY);
  },
};

export class ApiError extends Error {
  constructor(code, message, detail, status) {
    super(message || code);
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

/** 需要"踢回登录页"时由上层注册回调，避免 api 层直接依赖 router */
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

function buildQuery(params) {
  if (!params) return '';
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    usp.append(k, String(v));
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

/**
 * @param {string} path
 * @param {{method?:string, body?:any, admin?:boolean, participant?:boolean, query?:object, raw?:boolean, timeout?:number}} opts
 */
export async function request(path, opts = {}) {
  const { method = 'GET', body, admin = false, participant = false, query, raw = false, timeout = 30000 } = opts;

  const headers = {};
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (admin && store.aToken) headers.Authorization = `Bearer ${store.aToken}`;
  if (participant && store.pToken) headers.Authorization = `Bearer ${store.pToken}`;

  // 公网数据库 + 手机网络，请求可能长时间不返回，必须有超时，
  // 否则微信里会出现"点了一下永远没反应"
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  let res;
  try {
    res = await fetch(API_BASE + path + buildQuery(query), {
      method,
      headers,
      signal: ctrl.signal,
      body: body === undefined ? undefined : (body instanceof FormData ? body : JSON.stringify(body)),
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new ApiError('TIMEOUT', '网络有点慢，请检查网络后重试');
    throw new ApiError('NETWORK', '网络连接失败，请稍后重试');
  }
  clearTimeout(timer);

  if (res.status === 401) {
    if (admin) { store.aToken = ''; if (onUnauthorized) onUnauthorized('admin'); }
    if (participant) { store.pToken = ''; if (onUnauthorized) onUnauthorized('participant'); }
  }

  if (raw) {
    if (!res.ok) throw new ApiError('HTTP_' + res.status, '下载失败（' + res.status + '）', null, res.status);
    return res;
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch (e) {
    throw new ApiError('BAD_RESPONSE', `服务器返回异常（${res.status}）`, null, res.status);
  }

  if (!payload.ok) {
    throw new ApiError(payload.code || 'ERROR', payload.message || '操作失败', payload.detail, res.status);
  }
  return payload.data;
}

/** 文件下载：后台导出 CSV / ZIP 用，浏览器会直接触发下载 */
export async function download(path, query, fallbackName = 'export.csv') {
  const res = await request(path, { raw: true, admin: true, query, timeout: 180000 });
  const cd = res.headers.get('Content-Disposition') || '';
  let name = fallbackName;
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (m) { try { name = decodeURIComponent(m[1]); } catch (e) { /* 编码坏了就用兜底名 */ } }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立刻 revoke 在部分安卓浏览器会打断下载，延后一点更稳
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  return {
    name,
    entries: Number(res.headers.get('X-Zip-Entries') || 0),
    skipped: Number(res.headers.get('X-Zip-Skipped') || 0),
    truncated: res.headers.get('X-Zip-Truncated') === '1',
  };
}

// ------------------------------------------------------------------ 参与者端

export const api = {
  health: () => request('/api/health'),
  activity: () => request('/api/activity'),
  tasks: () => request('/api/tasks'),
  // 首页「清城少年立志瞬间」：公开照片墙，limit 是池子大小（前端一次显示 5 张）
  gallery: (limit) => request('/api/gallery', { query: { limit } }),

  register: (body) => request('/api/participant/register', { method: 'POST', body }),
  login: (body) => request('/api/participant/login', { method: 'POST', body }),

  me: () => request('/api/me', { participant: true }),
  updateMe: (body) => request('/api/me', { method: 'PUT', body, participant: true }),
  myTasks: (date) => request('/api/me/tasks', { participant: true, query: { date } }),
  myRecords: () => request('/api/me/records', { participant: true }),

  uploadLimits: () => request('/api/upload/limits'),
  uploadTicket: (body) => request('/api/upload/ticket', { method: 'POST', body, participant: true }),
  checkin: (body) => request('/api/checkin', { method: 'POST', body, participant: true, timeout: 60000 }),
  mediaUrls: (keys) => request('/api/media/urls', { method: 'POST', body: { keys }, participant: true }),
};

// ------------------------------------------------------------------ 后台

export const adminApi = {
  login: (body) => request('/api/admin/login', { method: 'POST', body }),
  me: () => request('/api/admin/me', { admin: true }),
  changePassword: (body) => request('/api/admin/password', { method: 'POST', body, admin: true }),

  dashboard: (date) => request('/api/admin/dashboard', { admin: true, query: { date } }),
  overview: (date) => request('/api/admin/overview', { admin: true, query: { date } }),
  trend: () => request('/api/admin/trend', { admin: true }),
  matrix: () => request('/api/admin/matrix', { admin: true }),
  schools: (limit) => request('/api/admin/schools', { admin: true, query: { limit } }),
  honors: (query) => request('/api/admin/honors', { admin: true, query }),
  duplicates: (limit) => request('/api/admin/duplicates', { admin: true, query: { limit } }),

  checkins: (query) => request('/api/admin/checkins', { admin: true, query }),
  checkinMedia: (id) => request(`/api/admin/checkin/${id}/media`, { admin: true }),
  deleteCheckin: (id) => request(`/api/admin/checkin/${id}`, { method: 'DELETE', admin: true }),

  participants: (query) => request('/api/admin/participants', { admin: true, query }),
  participant: (id) => request(`/api/admin/participant/${id}`, { admin: true }),

  media: (query) => request('/api/admin/media', { admin: true, query }),
  cleanupMedia: (body) => request('/api/admin/media/cleanup', { method: 'POST', body, admin: true, timeout: 180000 }),

  tasks: () => request('/api/admin/tasks', { admin: true }),
  updateTask: (id, payload) => request(`/api/admin/tasks/${id}`, { method: 'PUT', body: payload, admin: true }),
  resetTask: (id) => request(`/api/admin/tasks/${id}/reset`, { method: 'POST', admin: true }),
  settings: () => request('/api/admin/settings', { admin: true }),
  saveSettings: (values) => request('/api/admin/settings', { method: 'PUT', body: { values }, admin: true }),
  oplog: (pageSize) => request('/api/admin/oplog', { admin: true, query: { pageSize } }),
};
