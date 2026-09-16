'use strict';

/**
 * 活动设置：数据库 daka_config 覆盖环境变量。
 *
 * 为什么要有这一层：活动开始后发现"视频上限 30MB 太大"或者"临时关掉打卡"，
 * 不该让运维去改 .env 重启服务 —— 后台点一下就该生效。所以运行时优先读库，
 * 读不到再退回 .env 的默认值。
 */

const db = require('../db');
const config = require('../config');
const http = require('../http');

const DEFAULTS = {
  activity_title: config.activity.title,
  // 首页主画面（最大的两行字）单独分开配：
  // activity_title 是活动的正式全名，页脚、后台、导出都用它，
  // 而主画面要的是那句口号，两者混用会让页脚跟着变成口号。
  hero_eyebrow: '第四届清城少年志国庆打卡活动',
  hero_title: '少年有志 · 清城有光',
  activity_subtitle: '7 天 · 涵养 7 个心理品质',
  activity_intro: '国庆七天，每天一个主题任务。选一个你最想做的，做完上传照片就算打卡；'
    + '也可以一次挑好几个主题，集中上传。同一主题一天只能打一次卡。',
  activity_notice: '',
  // 活动日期：原本写死在 .env 的 ACTIVITY_START / ACTIVITY_END，
  // 开放到后台可配后，这里作为数据库覆盖键，保存即写回 config.activity，
  // 让打卡窗口校验与日期区间（time.js / checkin.js）即时生效。
  activity_start: config.activity.startDate,
  activity_end: config.activity.endDate,
  checkin_open: '1',
  photo_max_mb: String(config.upload.photoMaxMB),
  video_max_mb: String(config.upload.videoMaxMB),
  video_max_sec: String(config.upload.videoMaxSec),
  photo_max_count: String(config.upload.photoMaxCount),
  video_max_count: String(config.upload.videoMaxCount),
  honor_all_themes: String(config.activity.hzAllThemes),
  honor_theme_star: String(config.activity.hzThemeStar),
  honor_daka_master: String(config.activity.hzDakaMaster),
  gallery_public: '1',
  certificate_note: '登记的联系方式仅用于后期证书发放与活动通知，请确保填写准确。',
};

const LABELS = {
  activity_title: '活动标题（页脚、后台、导出用）',
  hero_eyebrow: '首页主画面 · 第一行小字',
  hero_title: '首页主画面 · 主标题',
  activity_subtitle: '副标题',
  activity_intro: '活动说明',
  activity_notice: '临时公告（显示在打卡页顶部，留空则不显示）',
  activity_start: '活动开始日期（YYYY-MM-DD，决定打卡窗口第一天）',
  activity_end: '活动结束日期（YYYY-MM-DD，决定打卡窗口最后一天）',
  checkin_open: '是否开放打卡（1 开 / 0 关）',
  photo_max_mb: '单张照片大小上限（MB）',
  video_max_mb: '单段视频大小上限（MB）',
  video_max_sec: '单段视频时长上限（秒）',
  photo_max_count: '每项最多照片数',
  video_max_count: '每项最多视频数',
  honor_all_themes: '全能少年：需覆盖主题数',
  honor_theme_star: '主题之星：单主题次数',
  honor_daka_master: '打卡达人：累计次数',
  gallery_public: '首页「清城少年立志瞬间」照片墙（1 开 / 0 关）',
  certificate_note: '证书说明文案',
};

let cache = null;
let cacheAt = 0;
const TTL = 5000; // 5 秒缓存，避免每个请求都查一次；后台保存时会主动失效

async function all(force) {
  const now = Date.now();
  if (!force && cache && now - cacheAt < TTL) return cache;
  let rows = [];
  try {
    rows = await db.q('SELECT k, v FROM daka_config');
  } catch (e) {
    // 建表之前也能跑（比如只想起服务看看）
    rows = [];
  }
  const map = { ...DEFAULTS };
  rows.forEach((r) => { map[r.k] = r.v; });
  applyActivityDates(map);
  cache = map;
  cacheAt = now;
  return map;
}

/** 校验并把 activity_start/activity_end 写回 config.activity，使同步的窗口校验即时生效 */
function applyActivityDates(map) {
  const s = /^\d{4}-\d{2}-\d{2}$/.test(map.activity_start || '') ? map.activity_start : config.activity.startDate;
  const e = /^\d{4}-\d{2}-\d{2}$/.test(map.activity_end || '') ? map.activity_end : config.activity.endDate;
  if (s && e && s <= e) {
    config.activity.startDate = s;
    config.activity.endDate = e;
  }
}

async function num(key) {
  const m = await all();
  const n = Number(m[key]);
  return Number.isFinite(n) ? n : Number(DEFAULTS[key]);
}

async function bool(key) {
  const m = await all();
  return m[key] === '1';
}

async function set(key, value) {
  await db.exec(
    `INSERT INTO daka_config (k, v, label) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE v = VALUES(v)`,
    [key, String(value ?? ''), LABELS[key] || '']
  );
  cache = null;
  return true;
}

async function setMany(obj) {
  // 活动日期整体校验：任一被修改时，取「新值优先、否则原默认」组合后校验
  if ('activity_start' in obj || 'activity_end' in obj) {
    const s = 'activity_start' in obj ? obj.activity_start : config.activity.startDate;
    const e = 'activity_end' in obj ? obj.activity_end : config.activity.endDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(e))) {
      throw http.bad('活动开始/结束日期必须是 YYYY-MM-DD 格式', 'BAD_DATE');
    }
    if (String(s) > String(e)) {
      throw http.bad('活动开始日期不能晚于结束日期', 'BAD_DATE');
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (!(k in DEFAULTS)) continue; // 只允许写白名单键，防止写脏数据
    await set(k, v);
  }
  cache = null;
  return all(true);
}

function invalidate() { cache = null; }

/** 给前端用的完整活动信息 */
async function publicActivity() {
  const m = await all();
  const dates = require('../time').activityDates();
  const now = require('../time');
  const today = now.today();
  return {
    title: m.activity_title,
    heroEyebrow: m.hero_eyebrow,
    heroTitle: m.hero_title,
    subtitle: m.activity_subtitle,
    intro: m.activity_intro,
    notice: m.activity_notice,
    certificateNote: m.certificate_note,
    checkinOpen: m.checkin_open === '1',
    galleryPublic: m.gallery_public === '1',
    dates,
    today,
    weekday: now.weekdayOf(today),
    // 演练模式：活动还没开始就真跑一遍时，前端要在最显眼处提醒"这不是正式活动"
    simulated: now.isSimulated() ? today : null,
    inActivity: now.diffDays(dates[0], today) >= 0 && now.diffDays(today, dates[dates.length - 1]) >= 0,
    limits: {
      photoMaxMB: Number(m.photo_max_mb),
      videoMaxMB: Number(m.video_max_mb),
      videoMaxSec: Number(m.video_max_sec),
      photoMaxCount: Number(m.photo_max_count),
      videoMaxCount: Number(m.video_max_count),
    },
    honors: {
      allThemes: Number(m.honor_all_themes) || 7,
      themeStar: Number(m.honor_theme_star) || 3,
      dakaMaster: Number(m.honor_daka_master) || 14,
    },
    themes: require('./stats').THEMES,
  };
}

module.exports = { all, num, bool, set, setMany, invalidate, publicActivity, DEFAULTS, LABELS, DATE_KEYS: ['activity_start', 'activity_end'] };
