'use strict';

/**
 * 全局错误处理 + 轻量限流。
 *
 * 限流用内存计数而不是 Redis：单进程、1000 人规模，一个 Map 足够，
 * 而且少一个组件就少一个上线当天会挂的地方。将来要横向扩进程，
 * 再换成 Redis 即可（接口不用改）。
 */

const { HttpError } = require('../http');

async function errorHandler(ctx, next) {
  try {
    await next();
    if (ctx.status === 404 && !ctx.body) {
      ctx.status = 404;
      ctx.body = { ok: false, code: 'NOT_FOUND', message: '接口不存在' };
    }
  } catch (e) {
    const isHttp = e instanceof HttpError;
    ctx.status = isHttp ? e.status : 500;
    ctx.body = {
      ok: false,
      code: isHttp ? e.code : 'INTERNAL_ERROR',
      message: isHttp ? e.message : '服务器出了点问题，请稍后重试',
      detail: isHttp ? e.detail : undefined,
    };

    if (!isHttp) {
      // 未知错误必须打全栈，否则线上只能靠猜
      ctx.app.emit('error', e, ctx);
    }
  }
}

/**
 * 计数式限流。
 * @param {{windowMs:number, max:number, key?:Function, message?:string}} opts
 */
function rateLimit(opts) {
  const windowMs = opts.windowMs || 60000;
  const max = opts.max || 60;
  const bucket = new Map();
  const keyOf = opts.key || ((ctx) => ctx.ip);

  // 定期清理过期桶，防止 Map 无限长大
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of bucket) if (v.reset < now) bucket.delete(k);
  }, windowMs);
  if (timer.unref) timer.unref();

  return async (ctx, next) => {
    const k = `${ctx.path}|${keyOf(ctx)}`;
    const now = Date.now();
    let rec = bucket.get(k);
    if (!rec || rec.reset < now) {
      rec = { count: 0, reset: now + windowMs };
      bucket.set(k, rec);
    }
    rec.count += 1;
    if (rec.count > max) {
      ctx.set('Retry-After', String(Math.ceil((rec.reset - now) / 1000)));
      throw new HttpError(429, 'TOO_MANY_REQUESTS', opts.message || '操作太频繁，请稍后再试');
    }
    await next();
  };
}

module.exports = { errorHandler, rateLimit };
