'use strict';

/**
 * 时间工具：整个系统只有一套日期口径 —— 北京时间（UTC+8）的自然日。
 *
 * 为什么必须服务端算日期：
 * 手机系统时间可以随便改，如果信客户端传的 date，参与者能把 10/08 的打卡
 * 记到 10/03 上，或者一天反复刷打卡。所以 checkin_date 一律服务端生成。
 */

const config = require('./config');

const OFFSET_MS = config.tzOffsetMinutes * 60 * 1000;

/** 当前北京时间对应的 Date（其 UTC 字段即北京本地字段） */
function nowInTz(base) {
  const d = base ? new Date(base) : new Date();
  return new Date(d.getTime() + OFFSET_MS);
}

/** 北京时间 YYYY-MM-DD */
function today(base) {
  // 演练模式：config.debug.today 已做双重开关校验，非演练时恒为空串
  if (config.debug.today) return config.debug.today;
  const d = nowInTz(base);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 当前日期是否处于演练模式（前端/后台用来打横幅） */
function isSimulated() {
  return Boolean(config.debug.today);
}

/** 北京时间 YYYY-MM-DD HH:mm:ss */
function nowStr(base) {
  const d = nowInTz(base);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** 北京时间的小时数 0-23 */
function hour(base) {
  return nowInTz(base).getUTCHours();
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** '2026-10-01' → '周四' */
function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** 把 'YYYY-MM-DD' 转成 Date（UTC 0 点，仅用于做日期加减） */
function parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** 两个日期相差天数（b - a） */
function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

/** 活动日期区间（含首尾） */
function activityDates() {
  const { startDate, endDate } = config.activity;
  const out = [];
  let cur = startDate;
  let guard = 0;
  while (diffDays(cur, endDate) >= 0 && guard++ < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** 生成 MySQL 可用的日期字面量，避免时区偏移 */
function toSqlDate(dateStr) {
  return dateStr;
}

module.exports = { today, nowStr, hour, weekdayOf, addDays, diffDays, activityDates, toSqlDate, nowInTz, parseDate, isSimulated };
