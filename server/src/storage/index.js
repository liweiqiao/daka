'use strict';

/**
 * 存储驱动工厂。
 *
 * 抽象出来是为了「先用本地磁盘跑通、拿到七牛凭证后改一行 .env 就切过来」，
 * 前端的调用方式完全不用动：
 *   - 七牛：前端拿 token 直传七牛（不占我们的服务器带宽）
 *   - 本地：前端直奔我们的 /api/upload/local（服务器中转）
 * 两种模式都用同样的 objectKey 命名规范，统计和导出逻辑只认 key。
 */

const config = require('../config');

let instance = null;

function getStorage() {
  if (instance) return instance;
  if (config.storage.driver === 'qiniu') {
    instance = require('./qiniu');
  } else {
    instance = require('./local');
  }
  return instance;
}

/**
 * 统一对象键：daka/{活动年}/{日期}/{参与者ID}/{类型}/{时间戳}-{随机}.{ext}
 * 这样按前缀就能拉出「某天某个人的全部凭证」，也方便后台按天归档下载。
 */
function buildObjectKey({ date, participantId, mediaType, ext, batchNo }) {
  const y = (date || '').slice(0, 4) || String(new Date().getFullYear());
  const safeExt = String(ext || 'bin').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toLowerCase() || 'bin';
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const b = batchNo ? `${batchNo}-` : '';
  return `daka/${y}/${date}/${participantId}/${mediaType}/${b}${ts}-${rand}.${safeExt}`;
}

/** 从 mime 推扩展名（防止前端乱传 filename） */
const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/3gpp': '3gp',
};

function extFromMime(mime) {
  return MIME_EXT[String(mime || '').toLowerCase()] || '';
}

module.exports = { getStorage, buildObjectKey, extFromMime, MIME_EXT };
