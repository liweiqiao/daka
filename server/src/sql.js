'use strict';

/**
 * SQL 小工具。
 *
 * 为什么要 `int()`：MySQL 的预处理语句对 `LIMIT ?` 支持很脆
 * （传字符串会报 "Incorrect arguments to mysqld_stmt_execute"），
 * 所以分页/条数这类值统一强制转成安全整数后直接内联进 SQL。
 * 因为它一定是整数、一定不含引号，所以不存在注入风险。
 */

function int(v, def = 0, { min = 0, max = 1000000 } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** 把 '2026-10-03' 之类的日期校验干净，不合法返回 def */
function date(v, def = '') {
  const s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : def;
}

/** 排序字段白名单：只能从给定集合里挑，杜绝把用户输入拼进 ORDER BY */
function orderBy(v, allowed, def) {
  const s = String(v || '');
  return allowed.includes(s) ? s : def;
}

/** IN (?,?,?) 的占位符串 */
function placeholders(arr) {
  return arr.map(() => '?').join(',');
}

module.exports = { int, date, orderBy, placeholders };
