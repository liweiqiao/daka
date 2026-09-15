'use strict';

/**
 * 服务端视频转码（兜底）。
 *
 * 为什么需要：前端已经在上传前做了客户端压缩（compressVideo），但微信内置浏览器
 * 大多不支持 MediaRecorder 录制 MP4，会回退原片上传。local 驱动下文件过我们服务器，
 * 正好在落盘前用 ffmpeg 再转一道，把「前端压不动」的视频也压下来，省存储也省带宽。
 *
 * 设计原则（兜底 = best-effort）：
 *   - 只在 config.transcode.enabled 且 ffmpeg 可用时尝试；
 *   - 源体积太小（< minSourceMB）不转，没意义反而费 CPU；
 *   - 转码后没变小（源已经很紧凑 / 转码反而变大）→ 保留原片；
 *   - 任何异常 / 超时 / ffmpeg 崩溃 → 一律回退原片，绝不让上传失败。
 *
 * 七牛(qiniu)驱动下文件不过我们服务器，public.js 不会调用本模块。
 */

const path = require('path');
const fsp = require('fs/promises');
const { spawn, execFileSync } = require('child_process');
const config = require('../config');
const { safeUnlink } = require('../fsx');

let _available = null; // null=尚未探测
let _warnedDev = false;

function ffmpegBin() {
  return config.transcode.ffmpegBin || 'ffmpeg';
}

/** 探测 ffmpeg 是否可用（带缓存，避免每次上传都 spawn 一次） */
function isAvailable() {
  if (_available !== null) return _available;
  _available = false;
  try {
    execFileSync(ffmpegBin(), ['-version'], { stdio: 'ignore', timeout: 5000 });
    _available = true;
  } catch (e) {
    _available = false;
  }
  return _available;
}

/**
 * 跑一次 ffmpeg 转码。
 * @returns {Promise<boolean>} 是否成功生成输出文件（退出码 0）
 */
function runFfmpeg(inFile, outFile) {
  return new Promise((resolve) => {
    const t = config.transcode;
    const args = [
      '-y',
      '-i', inFile,
      // 限制高度不超过 maxHeight，宽度按比例自动算（-2 保证偶数）；
      // 用命名参数 w=/h= 写法，避免 filter 内部冒号被当成 filter 分隔符
      // 用单引号包住含逗号的 min() 表达式，否则 ffmpeg 会把逗号当成 filter 链分隔符，
      // 把 `min(720,ih)` 拆成两段，报 "No such filter: 'ih)'"
      '-vf', `scale=w=-2:h='min(${t.maxHeight},ih)'`,
      '-c:v', 'libx264',
      '-preset', t.preset,
      '-b:v', `${t.videoBitrateK}k`,
      '-maxrate', `${t.videoBitrateK}k`,
      '-bufsize', `${t.videoBitrateK * 2}k`,
      '-pix_fmt', 'yuv420p', // 部分 QuickTime 源是 yuv422，浏览器播不了，统一转 yuv420p
      '-movflags', '+faststart', // moov atom 前置，支持边下边播
      '-c:a', 'aac',
      '-b:a', `${t.audioBitrateK}k`,
      outFile,
    ];

    let proc;
    let settled = false;
    const finish = (ok) => { if (!settled) { settled = true; resolve(ok); } };
    let timer = null;

    try {
      proc = spawn(ffmpegBin(), args);
    } catch (e) {
      return finish(false);
    }

    // ffmpeg 把进度打在 stderr，这里不收集（避免大文件内存膨胀），只看退出码
    if (proc.stderr) proc.stderr.on('data', () => {});
    proc.on('error', () => finish(false));
    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      finish(code === 0);
    });

    // 转码可能很慢（约等于视频时长），超时就杀掉回退原片，别卡死上传请求
    timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (e) {}
      finish(false);
    }, t.timeoutMs);
  });
}

/**
 * 转码一段视频 buffer（兜底）。
 * @param {Buffer} inputBuffer
 * @returns {Promise<{buffer: Buffer, mime: string}|null>}
 *   成功返回新的 MP4 buffer（mime 固定 video/mp4），否则返回 null（调用方保留原片）
 */
async function transcodeVideoBuffer(inputBuffer) {
  if (!config.transcode.enabled) return null;
  if (!isAvailable()) {
    if (config.env === 'development' && !_warnedDev) {
      _warnedDev = true;
      console.warn('[transcode] 未检测到 ffmpeg，服务端视频压缩已跳过（仅开发期提示一次；生产环境请看启动自检警告）');
    }
    return null;
  }
  const minBytes = config.transcode.minSourceMB * 1024 * 1024;
  if (!inputBuffer || inputBuffer.length < minBytes) return null;

  const tmp = config.upload.tmpDir;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inFile = path.join(tmp, `tc-in-${stamp}.bin`);
  const outFile = path.join(tmp, `tc-out-${stamp}.mp4`);

  try {
    await fsp.writeFile(inFile, inputBuffer);
    const ok = await runFfmpeg(inFile, outFile);
    if (!ok) return null;
    const st = await fsp.stat(outFile).catch(() => null);
    if (!st || !st.size) return null;
    // 没压下来（源已经很紧凑 / 转码反而变大）→ 保留原片
    if (st.size >= inputBuffer.length) return null;
    const outBuf = await fsp.readFile(outFile);
    return { buffer: outBuf, mime: 'video/mp4' };
  } catch (e) {
    return null;
  } finally {
    // Windows 上刚结束的写流句柄可能还没放开，用带退避重试的 safeUnlink
    await safeUnlink(inFile).catch(() => {});
    await safeUnlink(outFile).catch(() => {});
  }
}

module.exports = { isAvailable, transcodeVideoBuffer };
