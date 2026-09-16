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
const time = require('../time');

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
  honor_theme_cert: String(config.activity.hzThemeCert),
  honor_total: String(config.activity.hzTotal),
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
  honor_theme_cert: '主题专项证书：单主题需完成任务数',
  honor_total: '全能少年：累计需完成任务次数',
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

/**
 * 把数据库里的活动日期 + 荣誉门槛写回 config.activity，让同步读的代码
 * （checkin.js 窗口校验、stats.js 日序、export.js 门槛）即时拿到动态值。
 *
 * 只改库不写回的后果：后台改了也不生效，所有读 config.activity 的地方
 * 仍在用 .env 的旧值 —— 这是"动态配置"最容易漏的一环。
 */
function applyActivityDates(map) {
  const s = /^\d{4}-\d{2}-\d{2}$/.test(map.activity_start || '') ? map.activity_start : config.activity.startDate;
  const e = /^\d{4}-\d{2}-\d{2}$/.test(map.activity_end || '') ? map.activity_end : config.activity.endDate;
  if (s && e && s <= e) {
    config.activity.startDate = s;
    config.activity.endDate = e;
  }
  // 荣誉门槛：同样支持后台覆盖写回（>0 才认，防止把门槛改成 0 或负数）
  const posInt = (v, d) => { const x = Number(v); return Number.isInteger(x) && x > 0 ? x : d; };
  config.activity.hzThemeCert = posInt(map.honor_theme_cert, config.activity.hzThemeCert);
  config.activity.hzTotal = posInt(map.honor_total, config.activity.hzTotal);
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
  const dateChange = 'activity_start' in obj || 'activity_end' in obj;
  let shiftDays = 0;

  // 活动日期整体校验：任一被修改时，取「新值优先、否则原生效值」组合后校验
  if (dateChange) {
    // 先强制读一次库，把当前生效日期同步进 config.activity，再算偏移量
    await all(true);
    const s = 'activity_start' in obj ? obj.activity_start : config.activity.startDate;
    const e = 'activity_end' in obj ? obj.activity_end : config.activity.endDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(e))) {
      throw http.bad('活动开始/结束日期必须是 YYYY-MM-DD 格式', 'BAD_DATE');
    }
    if (String(s) > String(e)) {
      throw http.bad('活动开始日期不能晚于结束日期', 'BAD_DATE');
    }
    // ★ 任务卡跟着活动日期走：以任务卡实际最早的 day_date 为基准整体平移，
    //   保证改完后任务卡第一天对齐新的活动开始日。
    //   不能拿 config.activity.startDate 做基准 —— 后台配置与任务卡可能脱节
    //   （旧版本改日期不平移任务卡），按配置算会把偏移量算错。
    //   即使新日期与已存配置相同，只要任务卡没对齐也会被拉回来。
    const r = await db.one('SELECT MIN(day_date) AS minDay FROM daka_task');
    shiftDays = r && r.minDay ? time.diffDays(r.minDay, String(s)) : 0;
    if (Math.abs(shiftDays) > 3650) {
      throw http.bad('活动日期偏移过大，请检查日期是否填对', 'BAD_DATE');
    }
  }

  for (const [k, v] of Object.entries(obj)) {
    if (!(k in DEFAULTS)) continue; // 只允许写白名单键，防止写脏数据
    if (dateChange && (k === 'activity_start' || k === 'activity_end')) continue; // 日期键走下面的事务
    await set(k, v);
  }

  if (dateChange) {
    const s = 'activity_start' in obj ? obj.activity_start : config.activity.startDate;
    const e = 'activity_end' in obj ? obj.activity_end : config.activity.endDate;
    // 事务保证：日期配置写库与任务卡平移要么都成功、要么都不动，
    // 不会出现"日期改了但任务卡还在原地"的中间态
    await db.tx(async (c) => {
      for (const [k, v] of [['activity_start', s], ['activity_end', e]]) {
        await c.exec(
          `INSERT INTO daka_config (k, v, label) VALUES (?,?,?)
           ON DUPLICATE KEY UPDATE v = VALUES(v)`,
          [k, String(v), LABELS[k] || '']
        );
      }
      if (shiftDays !== 0) {
        // 唯一键 uk_day_theme 下不能一步整体平移：+1 时"已移走的行"会撞上
        // "还没移走的行"（MySQL 逐行校验唯一约束）。两段式：先全部跳到
        // 远端无人的日期区间，再落到目标位置，全程在同一事务里。
        // 偏移量夹紧成整数后内联（MySQL 预处理语句里 INTERVAL ? 不可靠）。
        const FAR = 100000; // 约 273 年，远超任何真实活动跨度
        await c.exec(
          `UPDATE daka_task SET day_date = DATE_ADD(day_date, INTERVAL ${FAR} DAY)`
        );
        const rest = Math.trunc(shiftDays) - FAR;
        // MySQL 单表 UPDATE 从左到右求值：day_date 已是新值，weekday 正好
        // 按平移后的日期重算 —— 别调换这两行的顺序。
        await c.exec(
          `UPDATE daka_task
             SET day_date = DATE_ADD(day_date, INTERVAL ${rest} DAY),
                 weekday = ELT(WEEKDAY(day_date) + 1, '周一','周二','周三','周四','周五','周六','周日')`
        );
      }
    });
  }

  cache = null;
  const values = await all(true);
  return { values, taskShiftDays: dateChange ? shiftDays : 0 };
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
      themeCert: Number(m.honor_theme_cert) || 7,
      total: Number(m.honor_total) || 20,
    },
    themes: require('./stats').THEMES,
  };
}

module.exports = { all, num, bool, set, setMany, invalidate, publicActivity, DEFAULTS, LABELS, DATE_KEYS: ['activity_start', 'activity_end'] };
