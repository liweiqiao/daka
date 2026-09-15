'use strict';

/**
 * 文件类型校验 —— 只看文件头，不看扩展名。
 *
 * 为什么必须做：七牛那边我们用 mimeLimit 拦住了类型，但「本地驱动」是
 * 服务器中转，前端说自己是 jpg 就信它会出事（传个可执行文件上来、
 * 或者传个超大文本充照片）。所以落盘前读前 16 字节核对一遍。
 * 注意这是"防呆+防滥用"，不是杀毒，活动场景下够用。
 */

const SIGNATURES = [
  { type: 'image', mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image', mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image', mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
];

/** WebP: RIFF....WEBP */
function isWebp(b) {
  return b.length >= 12
    && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
}

/** ISO BMFF（mp4/mov/m4v/3gp）：第 4-8 字节为 'ftyp' */
function isoBmffBrand(b) {
  if (b.length < 12) return '';
  const tag = b.toString('latin1', 4, 8);
  if (tag !== 'ftyp') return '';
  return b.toString('latin1', 8, 12);
}

/** HEIC/HEIF 也走 ftyp，属于图片 */
const IMAGE_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif']);
const VIDEO_BRANDS = new Set(['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'dash', 'qt  ', '3gp4', '3gp5', 'M4V ', 'M4A ', 'mmp4']);

/**
 * @param {Buffer} buf 文件前若干字节（至少 16 字节）
 * @returns {{type:'image'|'video'|'', mime:string}}
 */
function detect(buf) {
  if (!buf || buf.length < 4) return { type: '', mime: '' };

  for (const s of SIGNATURES) {
    if (s.bytes.every((v, i) => buf[i] === v)) return { type: s.type, mime: s.mime };
  }
  if (isWebp(buf)) return { type: 'image', mime: 'image/webp' };

  const brand = isoBmffBrand(buf);
  if (brand) {
    if (IMAGE_BRANDS.has(brand.trim().toLowerCase())) return { type: 'image', mime: 'image/heic' };
    if (VIDEO_BRANDS.has(brand) || brand.startsWith('3g')) return { type: 'video', mime: 'video/mp4' };
    // 认不出具体品牌但确实是 ftyp 容器，按视频放行（手机拍的 mov 品牌很多）
    return { type: 'video', mime: 'video/mp4' };
  }

  return { type: '', mime: '' };
}

/** 校验并返回真实类型；不合法抛错 */
function assert(buf, expectType) {
  const got = detect(buf);
  if (!got.type) {
    const e = new Error('无法识别的文件格式，请上传手机拍摄的照片或视频原文件');
    e.code = 'BAD_FILE_TYPE';
    throw e;
  }
  if (expectType && got.type !== expectType) {
    const e = new Error(expectType === 'image'
      ? '这里需要上传照片，请检查是不是选成了视频'
      : '这里需要上传视频，请检查是不是选成了照片');
    e.code = 'BAD_FILE_TYPE';
    throw e;
  }
  return got;
}

module.exports = { detect, assert };
