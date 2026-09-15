/**
 * appstate.js —— 极简全局状态（不上 Pinia，这规模用 reactive 足够）。
 *
 * 只放两类东西：登录态、活动信息缓存。
 * 活动信息（标题/说明/日期/上限）在多个页面都要用，缓存一次避免每页都请求。
 */

import { reactive, computed } from 'vue';
import { api, store as tokenStore } from './api.js';

export const state = reactive({
  activity: null,
  activityLoaded: false,
  taskDict: null,          // { themes, days } 完整 7 天字典，打卡页与记录页共用
  me: null,                 // { participant, progress, today }
  meLoaded: false,
  today: '',
  loading: false,
  offline: false,
  // 服务端开了"模拟日期"时这里是那天的日期，否则空串。
  // 所有页面都要能看见横幅，所以启动时单独拉一次 /api/health
  simulated: '',
});

/**
 * 本地是否有参与者 token。
 *
 * ★ 这个才是"要不要引导去登记"的判据，不是 isRegistered。
 * 踩过的坑：早期用 isRegistered（= 有 token **且** state.me 已加载）来判断，
 * 结果每次刷新页面时 state.me 还是 null，页面直接判定"没登记"、
 * 连 loadMe() 都不去调 —— 表现就是家长第二天再打开链接，
 * 系统又让他重新登记一遍，直接违背"信息只填一次"。
 */
export const hasToken = computed(() => !!tokenStore.pToken);

/** 已登记且服务端认这个 token（token 有 + state.me 拉到了） */
export const isRegistered = computed(() => !!tokenStore.pToken && !!state.me);

/** 今天已完成的主题集合，打卡页用来置灰 */
export const todayDoneSet = computed(() => {
  const set = new Set();
  const t = state.me && state.me.today;
  if (t && Array.isArray(t.tasks)) t.tasks.forEach((x) => { if (x.done) set.add(x.theme); });
  return set;
});

export async function loadActivity(force = false) {
  if (state.activityLoaded && !force) return state.activity;
  const data = await api.activity();
  state.activity = data;
  state.today = data.today;
  state.simulated = data.simulated || state.simulated;
  state.activityLoaded = true;
  return data;
}

/**
 * 启动时拉一次健康检查，主要是为了拿"是否演练模式"。
 * 失败不影响任何功能，所以静默处理。
 */
export async function loadHealth() {
  try {
    const h = await api.health();
    state.simulated = h.simulated || '';
  } catch (e) {
    state.simulated = '';
  }
}

export async function loadTaskDict(force = false) {
  if (state.taskDict && !force) return state.taskDict;
  state.taskDict = await api.tasks();
  return state.taskDict;
}

/** 拉取"我"的信息；401 时内部已清 token，调用方按未登记处理 */
export async function loadMe(force = false) {
  if (!tokenStore.pToken) { state.me = null; state.meLoaded = true; return null; }
  if (state.me && !force) return state.me;
  try {
    const data = await api.me();
    state.me = data;
    state.meLoaded = true;
    return data;
  } catch (e) {
    state.me = null;
    state.meLoaded = true;
    return null;
  }
}

export function setParticipant(me) {
  state.me = me;
  state.meLoaded = true;
}

export function logoutParticipant() {
  tokenStore.pToken = '';
  state.me = null;
  state.meLoaded = true;
}

/** 服务端返回的 progress 直接回填，省一次请求 */
export function applyProgress(progress) {
  if (state.me && progress) state.me.progress = progress;
}

/** 打卡成功后本地也要更新"今天已完成"，否则卡片不会立刻置灰 */
export function markDoneThemes(themes) {
  if (!state.me || !state.me.today) return;
  const set = new Set(themes);
  state.me.today.tasks.forEach((t) => { if (set.has(t.theme)) t.done = true; });
  state.me.today.doneCount = state.me.today.tasks.filter((t) => t.done).length;
  state.me.today.remaining = state.me.today.tasks.length - state.me.today.doneCount;
}

export { tokenStore };
