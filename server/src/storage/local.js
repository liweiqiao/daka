'use strict';

/**
 * 本地磁盘驱动（开发/内网部署用）。
 *
 * 目录结构直接镜像 objectKey：
 *   uploads/daka/2026/2026-10-01/12/image/xxx.jpg
 * 好处是可以直接用资源管理器按天打开、批量打包发给活动方。
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const ROOT = config.storage.local.dir;

function absOf(key) {
  const safe = String(key).replace(/\\/g, '/').replace(/\.\.+/g, '').replace(/^\/+/, '');
  return path.join(ROOT, safe);
}

function ensureRoot() {
  fs.mkdirSync(ROOT, { recursive: true });
}

/**
 * 把 objectKey 解析成绝对路径，并做一次"真的还在上传目录里"的校验。
 *
 * 为什么要单独做：这个结果会被交给文件流去读，一旦 key 里混进 `../`
 * 就变成任意文件读取。absOf 里虽然已经替换过 `..`，但显式的路径前缀
 * 比对才是可靠防线（防的是 URL 编码、符号链接等花式绕过）。
 *
 * @returns {string|null} 合法返回绝对路径，越界返回 null
 */
function resolveForServing(key) {
  const safe = String(key || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!safe || safe.includes('\0')) return null;
  const base = path.resolve(ROOT);
  const abs = path.resolve(base, safe);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}

/** 本地模式没有前端直传，前端必须打我们的接口 */
function createUploadTicket() {
  return { mode: 'local', uploadUrl: '/api/upload/local' };
}

/** 落盘：从 Buffer 写文件 */
async function saveBuffer(key, buffer) {
  const p = absOf(key);
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, buffer);
  return { size: buffer.length, sha1: crypto.createHash('sha1').update(buffer).digest('hex') };
}

function publicUrl(key, opts = {}) {
  const base = config.storage.local.publicBase || opts.origin || '';
  return `${base}/media/${String(key).replace(/^\/+/, '')}`;
}

/** 本地模式不需要签名 */
function signedUrl(key, opts) {
  return publicUrl(key, opts);
}

/**
 * 统一出口，与 qiniu 驱动保持同签名。
 * 本地模式没有私有空间的概念，直接返回直链。
 */
function mediaUrl(key, opts) {
  return publicUrl(key, opts);
}

async function remove(key) {
  try {
    await fsp.unlink(absOf(key));
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}

/** 确认文件真的在磁盘上，且大小对得上（防止"前端说传了其实没传"） */
async function stat(key) {
  try {
    const s = await fsp.stat(absOf(key));
    return { exists: true, size: s.size };
  } catch (e) {
    return { exists: false, size: 0 };
  }
}

/** 用于清理任务：列出前缀下所有 key */
async function listKeys(prefix) {
  const out = [];
  async function walk(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push(path.relative(ROOT, full).replace(/\\/g, '/'));
    }
  }
  await walk(path.join(ROOT, String(prefix || '').replace(/^\/+/, '')));
  return out;
}

module.exports = {
  name: 'local',
  createUploadTicket,
  saveBuffer,
  publicUrl,
  signedUrl,
  mediaUrl,
  remove,
  stat,
  listKeys,
  ensureRoot,
  resolveForServing,
  absOf,
  root: ROOT,
};
