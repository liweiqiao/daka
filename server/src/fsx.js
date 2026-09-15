'use strict';

/**
 * 文件系统小工具。
 *
 * 存在的唯一理由：**Windows 上删临时文件不能只删一次。**
 *
 * formidable 在构造 PersistentFile 时就打开了写流，写完之后流的 close 是异步的。
 * 我们读到文件内容（readFile 成功）不代表写流的句柄已经放开，
 * 此时 `fs.unlink` 会直接抛 EBUSY / EPERM —— 而这类清理代码习惯性地写成
 * `unlink(p).catch(()=>{})`，错误被吃掉，临时文件就一天天堆在磁盘上。
 *
 * 所以这里做两件事：
 *   1. safeUnlink —— 带退避重试的删除，ENOENT 直接算成功
 *   2. sweepTmp  —— 兜底清扫，按修改时间删掉过期的临时文件
 *      （重试也失败的极端情况，以及进程被强杀留下的残留，靠它收尾）
 */

const fs = require('fs/promises');
const path = require('path');

/** 删除失败时打一条带节流的告警：同一个目录 5 分钟内只提示一次，别把日志刷爆 */
const lastWarn = new Map();
function warn(msg) {
  const now = Date.now();
  if (now - (lastWarn.get('t') || 0) < 5 * 60000) return;
  lastWarn.set('t', now);
  console.warn(`  [fsx] ${msg}`);
}

/**
 * 删除一个文件，失败时退避重试。
 * @param {string} p 文件绝对/相对路径
 * @param {object} [opts]
 * @param {number} [opts.tries=6] 最多尝试几次
 * @param {number} [opts.baseDelay=40] 首次退避毫秒，逐次翻倍
 * @returns {Promise<boolean>} 是否已经不存在（true = 删掉了或本来就没有）
 */
async function safeUnlink(p, { tries = 6, baseDelay = 40 } = {}) {
  let delay = baseDelay;
  for (let i = 0; i < tries; i += 1) {
    try {
      await fs.unlink(p);
      return true;
    } catch (e) {
      if (e.code === 'ENOENT') return true;      // 已经没了，目的达到
      if (i === tries - 1) {
        // 不静默吞掉：删不掉就意味着磁盘会慢慢涨，日志里必须留痕，
        // 否则只会在"磁盘满了导致上传失败"的那天才发现。
        warn(`临时文件删不掉（重试 ${tries} 次仍失败）：${p} —— ${e.code || e.message}`);
        return false;
      }
      // EBUSY / EPERM / EACCES：句柄还没放开，等一会儿再来
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
  return false;
}

/**
 * 清扫目录里超过 maxAgeMs 没被碰过的文件（不递归、不进子目录）。
 * 用于兜住"删除失败"和"进程被强杀"这两种残留。
 *
 * @param {string} dir 目录（不存在就什么都不做）
 * @param {object} [opts]
 * @param {number} [opts.maxAgeMs=7200000] 默认 2 小时
 * @returns {Promise<{scanned:number, removed:number, bytes:number}>}
 */
async function sweepTmp(dir, { maxAgeMs = 2 * 60 * 60 * 1000 } = {}) {
  const out = { scanned: 0, removed: 0, bytes: 0 };
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    return out; // 目录不存在或没权限：静默跳过
  }

  const now = Date.now();
  for (const name of names) {
    const full = path.join(dir, name);
    out.scanned += 1;
    let st;
    try {
      st = await fs.stat(full);
    } catch (e) {
      continue; // 刚好被别人删了
    }
    if (!st.isFile()) continue;
    if (now - st.mtimeMs < maxAgeMs) continue;

    // eslint-disable-next-line no-await-in-loop
    const gone = await safeUnlink(full);
    if (gone) {
      out.removed += 1;
      out.bytes += st.size;
    }
  }
  return out;
}

module.exports = { safeUnlink, sweepTmp };
