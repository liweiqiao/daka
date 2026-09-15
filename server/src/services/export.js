'use strict';

/**
 * 导出：全部以 CSV 交付（Excel 能直接打开，也方便再透视）。
 *
 * 三个必须踩对的细节：
 * 1. 开头写 UTF-8 BOM，否则 Excel 打开中文全是乱码 —— 这是活动方最常抱怨的点。
 * 2. 用 CRLF 换行，Excel 对 LF 的兼容性在部分版本上会串行。
 * 3. 手机号等长数字用 ="..." 包住，不然 Excel 会当成科学计数法显示成 1.38E+10。
 */

const db = require('../db');
const stats = require('./stats');
const time = require('../time');
const config = require('../config');
const sql = require('../sql');
const { getStorage } = require('../storage');
const { ZipWriter } = require('./zip');

const BOM = '\ufeff';

function cell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // 公式注入防护：以 = + - @ 开头的内容 Excel 会当公式执行
  const needQuote = /[",\r\n]/.test(s) || /^[=+\-@\t]/.test(s);
  const safe = /^[=+\-@\t]/.test(s) ? `'${s}` : s;
  return needQuote ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** 长数字不转科学计数法的写法 */
function num(v) {
  const s = String(v ?? '');
  return /^\d{7,}$/.test(s) ? `="${s}"` : s;
}

function csv(rows) {
  return BOM + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

function rowsToCsv(header, list, mapper) {
  return csv([header, ...list.map(mapper)]);
}

// ------------------------------------------------------------ 打卡明细

/**
 * 明细表：一行 = 一次打卡（一项任务），这是最原始的事实表。
 * 附件链接用签名 URL，导出后 7 天内可点开下载，过期需重新导出。
 */
async function checkinsCsv({ date, theme, school, keyword, participantId, origin, expiresIn = 7 * 24 * 3600, limit = 200000 } = {}) {
  const where = ['1=1'];
  const params = [];
  if (date) { where.push('c.checkin_date = ?'); params.push(date); }
  if (theme) { where.push('c.theme = ?'); params.push(theme); }
  if (school) { where.push('p.school LIKE ?'); params.push(`%${school}%`); }
  if (keyword) { where.push('(p.name LIKE ? OR p.phone LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`); }
  if (participantId) { where.push('c.participant_id = ?'); params.push(Number(participantId) || 0); }

  const lim = sql.int(limit, 200000, { min: 1, max: 500000 });
  const rows = await db.q(
    `SELECT c.id, c.checkin_date, c.theme, c.task_name, c.is_offline, c.remark, c.created_at,
            p.id AS pid, p.name, p.school, p.phone,
            b.id AS batch_id, b.item_count, b.request_id, b.photo_count, b.video_count,
            (SELECT GROUP_CONCAT(m.object_key ORDER BY m.media_type, m.sort_no, m.id SEPARATOR '|')
               FROM daka_media m WHERE m.batch_id = b.id AND m.status = 1) AS media_keys
       FROM daka_checkin c
       JOIN daka_participant p ON p.id = c.participant_id
       JOIN daka_batch b ON b.id = c.batch_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.checkin_date, c.theme, p.school, p.name
      LIMIT ${lim}`,
    params
  );

  const storage = getStorage();
  // 同一批次的多条打卡共用一组凭证，缓存一下免得重复签名
  const urlCache = new Map();
  const urlsOf = (keys) => {
    if (!keys) return '';
    if (urlCache.has(keys)) return urlCache.get(keys);
    const out = String(keys).split('|')
      .map((k) => storage.mediaUrl(k, { origin, expiresIn }))
      .filter(Boolean)
      .join(' ');
    urlCache.set(keys, out);
    return out;
  };

  const header = ['日期', '星期', '主题', '任务名', '线下打卡点任务', '参与者ID', '姓名', '学校',
    '联系方式', '批次ID', '本次提交项数', '本次照片数', '本次视频数', '本项说明', '打卡时间', '凭证链接'];

  return rowsToCsv(header, rows, (r) => [
    r.checkin_date, time.weekdayOf(r.checkin_date), r.theme, r.task_name,
    r.is_offline ? '是' : '', r.pid, r.name, r.school, num(r.phone),
    r.batch_id, r.item_count, r.photo_count, r.video_count, r.remark || '', r.created_at,
    urlsOf(r.media_keys),
  ]);
}

// ---------------------------------------------------------- 参与者汇总

async function participantsCsv({ keyword = '', limit = 200000 } = {}) {
  const where = ['1=1'];
  const params = [];
  if (keyword) { where.push('(p.name LIKE ? OR p.phone LIKE ? OR p.school LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  const lim = sql.int(limit, 200000, { min: 1, max: 500000 });

  const rows = await db.q(
    `SELECT p.id, p.name, p.school, p.phone, p.created_at,
            COUNT(c.id) AS total,
            COUNT(DISTINCT c.theme) AS themes,
            COUNT(DISTINCT c.checkin_date) AS days,
            SUM(c.theme='专注') AS t0, SUM(c.theme='乐观') AS t1, SUM(c.theme='希望') AS t2,
            SUM(c.theme='自信') AS t3, SUM(c.theme='感恩') AS t4, SUM(c.theme='坚韧') AS t5,
            SUM(c.theme='活力') AS t6
       FROM daka_participant p
       LEFT JOIN daka_checkin c ON c.participant_id = p.id
      WHERE ${where.join(' AND ')}
      GROUP BY p.id, p.name, p.school, p.phone, p.created_at
      ORDER BY total DESC, themes DESC, p.id`,
    params
  );

  const header = ['参与者ID', '姓名', '学校', '联系方式', '登记时间', '累计打卡次数', '完成主题数',
    '打卡天数', '专注', '乐观', '希望', '自信', '感恩', '坚韧', '活力',
    '全能少年(7主题)', '打卡达人(≥' + config.activity.hzDakaMaster + '次)', '主题之星'];

  return rowsToCsv(header, rows, (r) => {
    const themeCount = [r.t0, r.t1, r.t2, r.t3, r.t4, r.t5, r.t6].map((x) => Number(x || 0));
    const star = ['专注', '乐观', '希望', '自信', '感恩', '坚韧', '活力']
      .filter((t, i) => themeCount[i] >= config.activity.hzThemeStar).join('、');
    return [
      r.id, r.name, r.school, num(r.phone), r.created_at,
      Number(r.total), Number(r.themes), Number(r.days),
      ...themeCount,
      Number(r.themes) >= 7 ? '是' : '',
      Number(r.total) >= config.activity.hzDakaMaster ? '是' : '',
      star,
    ];
  });
}

// -------------------------------------------------- 每日 × 主题 宽表

async function dailyMatrixCsv() {
  const m = await stats.matrix();
  const header = ['日期', '星期', ...m.themes, '当日合计'];
  const rows = m.dates.map((d) => {
    const cells = m.themes.map((t) => {
      const c = m.cells.find((x) => x.date === d && x.theme === t);
      return c ? c.count : 0;
    });
    return [d, time.weekdayOf(d), ...cells, cells.reduce((a, b) => a + b, 0)];
  });
  const footer = ['合计', '', ...m.themes.map((t) => {
    const r = m.byTheme.find((x) => x.theme === t);
    return r ? r.count : 0;
  }), m.cells.reduce((n, c) => n + c.count, 0)];
  return csv([header, ...rows, footer]);
}

// -------------------------------------------------------- 荣誉名单

async function honorsCsv() {
  const h = await stats.honors({});
  const out = [];
  out.push(['荣誉', '主题', '姓名', '学校', '联系方式', '累计打卡次数', '完成主题数', '说明']);

  h.allThemes.forEach((p) => out.push(['全能少年', '', p.name, p.school, num(p.phoneRaw), p.total, p.themes, '7 个主题每个至少完成 1 次']));
  h.dakaMaster.forEach((p) => out.push(['打卡达人', '', p.name, p.school, num(p.phoneRaw), p.total, p.themes, `累计有效打卡 ≥ ${h.thresholds.dakaMaster} 次`]));
  h.themeStar.forEach((g) => g.list.forEach((p) => out.push(['主题之星', g.theme, p.name, p.school, num(p.phoneRaw), p.total, p.themes, `${g.theme} 完成 ${p.themeCount} 次`])));

  return csv(out);
}

// ------------------------------------------------------- 附件清单

/**
 * 附件清单：给出每个文件的签名下载链接。
 * 用它可以：① 核对附件是否齐全 ② 把链接丢给下载工具批量拉取
 * ③ 给活动方留档（谁、哪天、哪个主题、传了几张）。
 */
async function mediaManifestCsv({ date, origin, expiresIn = 7 * 24 * 3600 } = {}) {
  const where = ['m.status = 1'];
  const params = [];
  if (date) { where.push('c.checkin_date = ?'); params.push(date); }

  // 媒体台账里存了服务端写入的权威 task_id，(参与者, 任务) 上有唯一键，
  // 所以这里是一对一关联 —— 不需要 GROUP BY，也就不会踩 ONLY_FULL_GROUP_BY。
  const rows = await db.q(
    `SELECT m.object_key, m.media_type, m.file_size, m.mime, m.file_name, m.created_at,
            c.checkin_date, c.theme, c.task_name, p.id AS pid, p.name, p.school, p.phone
       FROM daka_media m
       JOIN daka_checkin c
         ON c.participant_id = m.participant_id AND c.task_id = m.task_id
       JOIN daka_participant p ON p.id = m.participant_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.checkin_date, p.school, p.name, m.media_type, m.id`,
    params
  );

  const storage = getStorage();
  const header = ['日期', '主题', '任务名', '参与者ID', '姓名', '学校', '联系方式', '类型',
    '原始文件名', '大小(MB)', '格式', '存储key', '下载链接', '上传时间'];

  return rowsToCsv(header, rows, (r) => [
    r.checkin_date, r.theme, r.task_name, r.pid, r.name, r.school, num(r.phone),
    r.media_type === 'image' ? '照片' : '视频',
    r.file_name || '', (Number(r.file_size) / 1048576).toFixed(2), r.mime || '',
    r.object_key,
    storage.mediaUrl(r.object_key, { origin, expiresIn }),
    r.created_at,
  ]);
}

// --------------------------------------------------------- 重名清单

async function duplicatesCsv() {
  const list = await stats.duplicates();
  const header = ['姓名', '登记人数', '涉及学校数', '涉及手机号数', '疑似重复登记', '参与者ID', '学校', '联系方式', '累计打卡次数'];
  const rows = [];
  list.forEach((g) => {
    if (!g.people.length) rows.push([g.name, g.count, g.schoolCount, g.phoneCount, g.suspicious ? '是' : '', '', '', '', '']);
    g.people.forEach((p, i) => rows.push([
      i === 0 ? g.name : '', i === 0 ? g.count : '', i === 0 ? g.schoolCount : '',
      i === 0 ? g.phoneCount : '', i === 0 ? (g.suspicious ? '是' : '') : '',
      p.id, p.school, num(p.phoneRaw), p.total,
    ]));
  });
  return csv([header, ...rows]);
}

// ------------------------------------------------------------ 分发

const BUILDERS = {
  checkins: { file: () => `打卡明细_${time.today()}.csv`, build: checkinsCsv },
  participants: { file: () => `参与者汇总_${time.today()}.csv`, build: participantsCsv },
  daily: { file: () => `每日主题矩阵_${time.today()}.csv`, build: dailyMatrixCsv },
  honors: { file: () => `荣誉名单_${time.today()}.csv`, build: honorsCsv },
  media: { file: () => `附件清单_${time.today()}.csv`, build: mediaManifestCsv },
  duplicates: { file: () => `重名清单_${time.today()}.csv`, build: duplicatesCsv },
};

async function build(type, opts = {}) {
  const b = BUILDERS[type];
  if (!b) {
    const e = new Error(`不支持的导出类型：${type}`);
    e.code = 'BAD_EXPORT_TYPE';
    throw e;
  }
  const content = await b.build(opts);
  return { filename: b.file(), content, type };
}

// ------------------------------------------------- 附件打包（zip）

/**
 * 按日期导出附件 zip。
 *
 * local 驱动：直接从磁盘读，快且不耗流量。
 * qiniu 驱动：逐个用签名链接回源下载。1000 人 × 多张照片会很慢，
 *   所以加了 maxFiles 上限与并发限制，并在返回里提示剩余数量。
 *   日常清空间的推荐做法是"每天导一天的"，不要一次导整个活动。
 */
async function mediaZip({ date, maxFiles = 500, concurrency = 4, origin } = {}) {
  const lim = sql.int(maxFiles, 500, { min: 1, max: 3000 });
  const where = ['m.status = 1'];
  const params = [];
  if (date) { where.push('c.checkin_date = ?'); params.push(date); }

  const rows = await db.q(
    `SELECT m.object_key, m.media_type, m.file_size, p.name, p.school, c.checkin_date, c.theme
       FROM daka_media m
       JOIN daka_checkin c
         ON c.participant_id = m.participant_id AND c.task_id = m.task_id
       JOIN daka_participant p ON p.id = m.participant_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.checkin_date, p.school, p.name, m.id
      LIMIT ${lim}`,
    params
  );

  const storage = getStorage();
  const zip = new ZipWriter();
  const used = new Set();
  let skipped = 0;
  let bytes = 0;
  let done = 0;

  await runPool(rows, concurrency, async (r) => {
    try {
      let buf = null;
      if (storage.name === 'local') {
        const fsp = require('fs/promises');
        buf = await fsp.readFile(storage.absOf(r.object_key));
      } else {
        const url = storage.mediaUrl(r.object_key, { origin, expiresIn: 3600 });
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        buf = Buffer.from(await resp.arrayBuffer());
      }
      // 路径里去掉参与者姓名可能引起的重名覆盖，用 key 本身保证唯一
      let name = `${r.checkin_date}/${sanitize(r.school)}_${sanitize(r.name)}_${r.theme}/${r.object_key.split('/').pop()}`;
      let n = 2;
      while (used.has(name)) { name = name.replace(/(\.[^.]*)$/, `_${n++}$1`); }
      used.add(name);
      zip.add(name, buf);
      bytes += buf.length;
    } catch (e) {
      skipped += 1;
    }
    done += 1;
  });

  return {
    buffer: zip.finish(),
    entries: zip.entries,
    bytes,
    skipped,
    total: rows.length,
    truncated: rows.length >= lim,
  };
}

function sanitize(s) {
  return String(s || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').slice(0, 40) || '未填';
}

/** 带并发上限的遍历，避免同时开几千个请求把库和带宽打死 */
async function runPool(items, concurrency, fn) {
  const queue = items.slice();
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency || 4, queue.length || 1)) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await fn(item);
    }
  });
  await Promise.all(workers);
}

module.exports = { build, BUILDERS, mediaZip, mediaManifestCsv, csv, cell, num };
