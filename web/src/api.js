/**
 * api.js —— 统一的接口层。
 *
 * 三件事在这里一次性解决，业务组件里就不用重复处理：
 *   1. token 注入：参与者与管理员各存一个键，互不干扰
 *   2. 统一拆包：后端固定返回 { ok, data } / { ok:false, code, message }，
 *      这里直接把 data 抛出去、把 message 作为 Error 抛出，组件只管 try/catch
 *   3. 401 自动登出：token 过期时清掉本地态并跳登录，而不是让页面一直转圈
 */

const P_KEY = 'daka.p.token';
const A_KEY = 'daka.a.token';

export const store = {
  get pToken() { return localStorage.getItem(P_KEY) || ''; },
  set pToken(v) { v ? localStorage.setItem(P_KEY, v) : localStorage.removeItem(P_KEY); },
  get aToken() { return localStorage.getItem(A_KEY) || ''; },
  set aToken(v) { v ? localStorage.setItem(A_KEY, v) : localStorage.removeItem(A_KEY); },
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
    res = await fetch(path + buildQuery(query), {
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
  board: () => request('/api/board'),

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
  settings: () => request('/api/admin/settings', { admin: true }),
  saveSettings: (values) => request('/api/admin/settings', { method: 'PUT', body: { values }, admin: true }),
  oplog: (pageSize) => request('/api/admin/oplog', { admin: true, query: { pageSize } }),
};
