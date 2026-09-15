'use strict';

/**
 * 极简 ZIP 打包器（STORE 模式，不压缩）。
 *
 * 为什么自己写：活动方每天要"导出附件 → 清空云端空间"，
 * 这需要一个能一键打包下载的 zip。而 npm 上主流的 archiver/jszip
 * 会带进十几个依赖，为了一个存文件的场景不值得。
 *
 * 不压缩是对的：照片和视频本来就是压缩格式，再 deflate 一遍几乎不减小体积，
 * 反而白烧 CPU。STORE 模式只在文件名和目录结构上做封装。
 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/** 用固定长度小端写入，避免 Buffer.concat 反复拼接 */
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

// DOS 时间格式：ZIP 规范要求的古怪格式，用固定时间戳能让打包结果可复现
function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

class ZipWriter {
  constructor() {
    this.chunks = [];
    this.central = [];
    this.offset = 0;
    this.count = 0;
  }

  /**
   * 追加一个文件。
   * @param {string} name 目录里的路径，如 daka/2026-10-01/12/image/x.jpg
   * @param {Buffer} data
   */
  add(name, data) {
    const nameBuf = Buffer.from(String(name).replace(/\\/g, '/'), 'utf8');
    const crc = crc32(data);
    const { time, date } = dosDateTime();
    const size = data.length;

    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), // 0x0800 = UTF-8 文件名
      u16(time), u16(date),
      u32(crc), u32(size), u32(size),
      u16(nameBuf.length), u16(0),
      nameBuf,
    ]);

    this.chunks.push(local, data);
    this.central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0),
      u16(time), u16(date),
      u32(crc), u32(size), u32(size),
      u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(this.offset),
      nameBuf,
    ]));

    this.offset += local.length + size;
    this.count += 1;
    return this;
  }

  /** 收尾：写中央目录 + EOCD */
  finish() {
    const centralBuf = Buffer.concat(this.central);
    const eocd = Buffer.concat([
      u32(0x06054b50), u16(0), u16(0),
      u16(this.count), u16(this.count),
      u32(centralBuf.length), u32(this.offset), u16(0),
    ]);
    return Buffer.concat([...this.chunks, centralBuf, eocd]);
  }

  get entries() { return this.count; }
}

module.exports = { ZipWriter, crc32 };
