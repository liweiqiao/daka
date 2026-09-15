'use strict';

/**
 * 统一响应格式与错误类型。
 *
 * 所有接口都返回 { ok: true, data } 或 { ok: false, code, message, detail? }
 * 前端只认 ok 字段，业务码放 code，人话放 message（可直接弹给用户看）。
 */

class HttpError extends Error {
  constructor(status, code, message, detail) {
    super(message || code);
    this.status = status || 400;
    this.code = code || 'BAD_REQUEST';
    this.detail = detail;
    this.expose = true;
  }
}

const bad = (msg, code = 'BAD_REQUEST', detail) => new HttpError(400, code, msg, detail);
const unauth = (msg = '登录已过期，请重新登记', code = 'UNAUTHORIZED') => new HttpError(401, code, msg);
const forbidden = (msg = '没有权限', code = 'FORBIDDEN') => new HttpError(403, code, msg);
const notFound = (msg = '数据不存在', code = 'NOT_FOUND') => new HttpError(404, code, msg);
const tooMany = (msg = '操作太频繁，请稍后再试', code = 'TOO_MANY') => new HttpError(429, code, msg);
const conflict = (msg, code = 'CONFLICT', detail) => new HttpError(409, code, msg, detail);

function ok(ctx, data, extra) {
  ctx.status = 200;
  ctx.body = Object.assign({ ok: true, data }, extra || {});
}

/** 从 ctx.request.body 取字段，带必填与长度校验（并顺手 trim） */
function pick(body, key, { required = false, max = 0, min = 0, def = '' } = {}) {
  let v = body && body[key];
  if (v === undefined || v === null) v = '';
  v = String(v).trim();
  if (required && !v) throw bad(`请填写「${key}」`, 'MISSING_FIELD', { field: key });
  if (min && v && v.length < min) throw bad(`「${key}」至少 ${min} 个字符`, 'FIELD_TOO_SHORT', { field: key });
  if (max && v.length > max) throw bad(`「${key}」最多 ${max} 个字符`, 'FIELD_TOO_LONG', { field: key });
  if (!v && def) v = def;
  return v;
}

/** 手机号：中国大陆 11 位，1 开头，第二位 3-9 */
function assertPhone(phone) {
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    throw bad('请填写正确的 11 位手机号', 'BAD_PHONE', { field: 'phone' });
  }
  return phone;
}

/** 姓名：2-16 位，允许中文、字母、间隔号，不允许特殊符号 */
function assertName(name) {
  const n = name.replace(/\s+/g, '');
  if (n.length < 2 || n.length > 16) throw bad('姓名请填 2—16 个字', 'BAD_NAME', { field: 'name' });
  if (!/^[\u4e00-\u9fa5a-zA-Z·．.\u00b7]+$/.test(n)) {
    throw bad('姓名只能填中文或字母', 'BAD_NAME', { field: 'name' });
  }
  return n;
}

module.exports = { HttpError, bad, unauth, forbidden, notFound, tooMany, conflict, ok, pick, assertPhone, assertName };
