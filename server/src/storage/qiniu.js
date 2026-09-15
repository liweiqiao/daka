'use strict';

/**
 * 七牛云驱动。
 *
 * 三种 key 写法都要对，否则线上会出问题：
 * 1. 上传凭证：scope 用 `bucket:key`（精确到单个对象）+ insertOnly=1 +
 *    fsizeLimit/mimeLimit。这样即使 token 被扒走，攻击者也只能往这一个 key
 *    写一次，且类型大小都被卡死 —— 比 `scope: bucket` 安全得多。
 * 2. 访问链接：私有空间必须走 privateDownloadUrl 签名，有效期按需生成。
 *    未成年人照片不适合长期公开可访问。
 * 3. 删除/列举：走管理 API（BucketManager），只用于孤儿文件清理与归档导出。
 */

const qiniu = require('qiniu');
const config = require('../config');

const Q = config.storage.qiniu;

/** 区域 → 上传域名。前端 qiniu-js 直传要用它 */
const UPLOAD_HOSTS = {
  z0: 'https://upload.qiniup.com',      // 华东
  z1: 'https://upload-z1.qiniup.com',   // 华北
  z2: 'https://upload-z2.qiniup.com',   // 华南
  na0: 'https://upload-na0.qiniup.com', // 北美
  as0: 'https://upload-as0.qiniup.com', // 新加坡
  'cn-east-2': 'https://upload-cn-east-2.qiniup.com',
};

let mac = null;
function getMac() {
  if (!mac) mac = new qiniu.auth.digest.Mac(Q.accessKey, Q.secretKey);
  return mac;
}

let bucketManager = null;
function getBucketManager() {
  if (!bucketManager) {
    const conf = new qiniu.conf.Config();
    // 管理 API 只走 https，避免 SDK 老默认 http
    conf.useHttpsDomain = true;
    conf.useCdnDomain = false;
    bucketManager = new qiniu.rs.BucketManager(getMac(), conf);
  }
  return bucketManager;
}

function uploadHost() {
  return Q.uploadHost || UPLOAD_HOSTS[Q.region] || UPLOAD_HOSTS.z0;
}

function assertReady() {
  if (!Q.accessKey || !Q.secretKey || !Q.bucket) {
    const e = new Error('七牛未配置完整：请检查 QN_ACCESS_KEY / QN_SECRET_KEY / QN_BUCKET');
    e.code = 'QINIU_NOT_CONFIGURED';
    throw e;
  }
}

/**
 * 生成前端直传凭证。
 * @param {{key:string, mediaType:'image'|'video'}} opts
 */
function createUploadTicket({ key, mediaType }) {
  assertReady();
  const isVideo = mediaType === 'video';
  const maxBytes = (isVideo ? config.upload.videoMaxMB : config.upload.photoMaxMB) * 1024 * 1024;

  const putPolicy = new qiniu.rs.PutPolicy({
    scope: `${Q.bucket}:${key}`,
    expires: Q.tokenExpiresSec,
    insertOnly: 1,
    // 让七牛回传对象信息，前端可拿到 hash/大小，我们落库时就不必再 HEAD 一次
    returnBody: JSON.stringify({
      key: '$(key)',
      hash: '$(etag)',
      fsize: '$(fsize)',
      mimeType: '$(mimeType)',
      ext: '$(ext)',
    }),
    // 上传策略里的大小/类型限制是「网关级」拦截，比前端校验可靠
    fsizeLimit: maxBytes,
    mimeLimit: isVideo ? 'video/*' : 'image/*',
  });

  return {
    mode: 'qiniu',
    token: putPolicy.uploadToken(getMac()),
    key,
    uploadHost: uploadHost(),
    // 上传后前端可以直接用这个路径访问（私有空间会过期，但用于本地预览足够）
    previewUrl: Q.private ? '' : publicUrl(key),
    maxBytes,
    maxCount: isVideo ? config.upload.videoMaxCount : config.upload.photoMaxCount,
    expiresIn: Q.tokenExpiresSec,
  };
}

function normalizeDomain(d) {
  const s = String(d || Q.domain || '').replace(/\/+$/, '');
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/** 公开空间直链 */
function publicUrl(key) {
  const domain = normalizeDomain();
  if (!domain) return '';
  return `${domain}/${String(key).replace(/^\/+/, '')}`;
}

/**
 * 私有空间签名链接。
 * @param {string} key
 * @param {{expiresIn?:number, origin?:string}} opts
 */
function signedUrl(key, opts = {}) {
  if (!Q.private) return publicUrl(key);
  const domain = normalizeDomain();
  if (!domain) return '';
  const deadline = Math.floor(Date.now() / 1000) + (opts.expiresIn || 1800);
  // privateDownloadUrl 接受带协议的完整域名
  return getBucketManager().privateDownloadUrl(domain, String(key).replace(/^\/+/, ''), deadline);
}

/** 统一出口：私有→签名，公开→直链 */
function mediaUrl(key, opts) {
  return Q.private ? signedUrl(key, opts) : publicUrl(key);
}

function remove(key) {
  assertReady();
  return new Promise((resolve, reject) => {
    getBucketManager().delete(Q.bucket, String(key).replace(/^\/+/, ''), (err, respBody, respInfo) => {
      // 612 = 文件不存在，视为删除成功（幂等）
      if (err) return reject(err);
      if (respInfo && respInfo.statusCode === 200) return resolve(true);
      if (respInfo && respInfo.statusCode === 612) return resolve(false);
      reject(new Error(`七牛删除失败 status=${respInfo && respInfo.statusCode} body=${JSON.stringify(respBody)}`));
    });
  });
}

function stat(key) {
  assertReady();
  return new Promise((resolve) => {
    getBucketManager().stat(Q.bucket, String(key).replace(/^\/+/, ''), (err, respBody, respInfo) => {
      if (err || !respInfo || respInfo.statusCode !== 200) return resolve({ exists: false, size: 0 });
      resolve({ exists: true, size: Number(respBody.fsize) || 0, hash: respBody.hash, mime: respBody.mimeType });
    });
  });
}

/** 按前缀列举（用于孤儿清理与归档） */
function listKeys(prefix, limit = 1000) {
  assertReady();
  const bm = getBucketManager();
  const out = [];
  return new Promise((resolve, reject) => {
    const step = (marker) => {
      bm.listPrefix(Q.bucket, { prefix, limit: Math.min(1000, limit), marker: marker || '' }, (err, body, info) => {
        if (err) return reject(err);
        if (!info || info.statusCode !== 200) return reject(new Error(`七牛列举失败 status=${info && info.statusCode}`));
        (body.items || []).forEach((it) => out.push(it.key));
        if (body.marker && out.length < limit) return step(body.marker);
        resolve(out);
      });
    };
    step('');
  });
}

/** 批量删除（每次最多 1000 个 key） */
function batchRemove(keys) {
  assertReady();
  if (!keys.length) return Promise.resolve({ ok: 0, fail: 0 });
  const bm = getBucketManager();
  const ops = keys.map((k) => qiniu.rs.deleteOp(Q.bucket, String(k).replace(/^\/+/, '')));
  return new Promise((resolve, reject) => {
    bm.batch(ops, (err, body, info) => {
      if (err) return reject(err);
      if (!info || info.statusCode !== 200) return reject(new Error(`七牛批量删除失败 status=${info && info.statusCode}`));
      resolve({ ok: keys.length, raw: body });
    });
  });
}

function ready() {
  return Boolean(Q.accessKey && Q.secretKey && Q.bucket && Q.domain);
}

module.exports = {
  name: 'qiniu',
  createUploadTicket,
  publicUrl,
  signedUrl,
  mediaUrl,
  remove,
  batchRemove,
  stat,
  listKeys,
  uploadHost,
  ready,
  isPrivate: Q.private,
  bucket: Q.bucket,
};
