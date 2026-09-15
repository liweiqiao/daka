'use strict';

/**
 * 鉴权：两套 token，共用一个 JWT_SECRET，靠 typ 字段区分，避免串用。
 *
 * - 参与者 token 不放在 Cookie 里，而是 localStorage + Authorization 头。
 *   原因：微信内置浏览器的 Cookie 策略（尤其 iOS 的 ITP）很容易把跨站 Cookie 丢掉，
 *   而前后端分离部署时接口域名与页面域名不同，Cookie 反而更不稳。localStorage 万无一失。
 * - 有效期 60 天：活动 7 天 + 事后回看，中途不会把家长踢下线。
 */

const jwt = require('jsonwebtoken');
const config = require('./config');
const { unauth } = require('./http');

function signParticipant(participant) {
  return jwt.sign(
    { typ: 'p', pid: participant.id, name: participant.name },
    config.jwt.secret,
    { expiresIn: config.jwt.participantExpiresIn }
  );
}

function signAdmin(admin) {
  return jwt.sign(
    { typ: 'a', aid: admin.id, username: admin.username, displayName: admin.display_name || admin.username },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

function verify(token, expectTyp) {
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    if (expectTyp && payload.typ !== expectTyp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function bearer(ctx) {
  const h = ctx.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : '';
}

/** 参与者鉴权中间件：把 ctx.state.participant 填上 */
async function requireParticipant(ctx, next) {
  const payload = verify(bearer(ctx), 'p');
  if (!payload) throw unauth('登录信息已失效，请重新用手机号登记');
  ctx.state.participantId = payload.pid;
  ctx.state.participantName = payload.name;
  await next();
}

/** 后台鉴权中间件：把 ctx.state.admin 填上 */
async function requireAdmin(ctx, next) {
  const payload = verify(bearer(ctx), 'a');
  if (!payload) throw unauth('后台登录已过期，请重新登录', 'ADMIN_UNAUTHORIZED');
  ctx.state.admin = {
    id: payload.aid,
    username: payload.username,
    displayName: payload.displayName,
  };
  await next();
}

module.exports = { signParticipant, signAdmin, verify, bearer, requireParticipant, requireAdmin };
