'use strict';

/**
 * 打卡提交 —— 全系统最关键的一段逻辑。
 *
 * 去重与空白的处理原则：
 *   「能靠数据库约束拦住的，绝不靠应用层判断。」
 *   daka_checkin 上有 UNIQUE KEY uk_once (participant_id, task_id)。
 *   两个人同一毫秒提交、或者家长狂点提交按钮，最终都只会落一行数据，
 *   应用层拿到 ER_DUP_ENTRY 再翻成人话提示即可。
 *
 * 三种被"过滤"的情况分别有独立的原因码，前端能精确告诉用户哪里没算上：
 *   UNKNOWN_TASK   任务不存在
 *   NOT_TODAY      不是今天的任务（防止把 10/05 的打卡补到 10/03）
 *   DUPLICATE      这个主题今天已经打过卡了
 *   NO_PHOTO       没传照片（照片是必填项）
 *   BAD_MEDIA      凭证文件不属于本人 / 已被其它记录占用 / 文件不在存储上
 */

const db = require('../db');
const time = require('../time');
const http = require('../http');
const config = require('../config');
const settings = require('./settings');

const SKIP = {
  UNKNOWN_TASK: '任务不存在',
  NOT_TODAY: '不是当天的任务',
  DUPLICATE: '这个主题今天已经打过卡了',
  NO_PHOTO: '没有上传照片（照片是必填）',
  BAD_MEDIA: '凭证文件无效或已失效',
  TOO_MANY_PHOTO: `照片最多 ${config.upload.photoMaxCount} 张`,
  TOO_MANY_VIDEO: `视频最多 ${config.upload.videoMaxCount} 段`,
  ACTIVITY_CLOSED: '不在活动时间内',
};

/** 一次提交里最多允许勾选几个主题（防止有人构造超大请求） */
const MAX_ITEMS_PER_SUBMIT = 7;

async function loadTasksByIds(ids) {
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  return db.q(`SELECT * FROM daka_task WHERE id IN (${ph})`, ids);
}

/**
 * 提交打卡。
 * @param {number} participantId
 * @param {{requestId:string, items:Array, remark?:string}} payload
 * @param {{ip?:string, ua?:string}} meta
 */
async function submit(participantId, payload, meta = {}) {
  const requestId = http.pick(payload, 'requestId', { required: true, max: 64 });
  if (!/^[0-9a-zA-Z-]{8,64}$/.test(requestId)) {
    throw http.bad('请求标识不合法', 'BAD_REQUEST_ID');
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw http.bad('请至少选择一个打卡任务', 'NO_ITEM');
  if (items.length > MAX_ITEMS_PER_SUBMIT) {
    throw http.bad(`一次最多提交 ${MAX_ITEMS_PER_SUBMIT} 个主题`, 'TOO_MANY_ITEMS');
  }

  // 后台可以一键关掉打卡（比如数据显示异常需要先排查）
  if (!(await settings.bool('checkin_open'))) {
    throw http.bad('打卡通道暂时关闭，请稍后再试', 'CHECKIN_CLOSED');
  }

  const date = time.today(); // 服务端定日期，绝不信客户端

  // ---------- 0. 幂等：微信里网络抖动导致重复 POST，直接回放上次结果 ----------
  const existed = await db.one('SELECT * FROM daka_batch WHERE request_id = ?', [requestId]);
  if (existed) {
    const detail = await db.q(
      `SELECT c.task_id, c.theme, c.task_name, c.checkin_date
         FROM daka_checkin c WHERE c.batch_id = ? ORDER BY c.id`,
      [existed.id]
    );
    return {
      replay: true,
      date: existed.checkin_date,
      accepted: detail.map((d) => ({ taskId: d.task_id, theme: d.theme, taskName: d.task_name })),
      skipped: [],
      message: '这次打卡已经记录过了（无重复计入）',
      progress: await progress(participantId),
    };
  }

  // ---------- 1. 日期窗口 ----------
  const inWindow = time.diffDays(config.activity.startDate, date) >= 0
    && time.diffDays(date, config.activity.endDate) >= 0;

  // ---------- 2. 归一化 items，去重、逐项预检 ----------
  const seen = new Set();
  const incoming = [];
  const skipped = [];

  for (const raw of items) {
    const taskId = Number(raw && raw.taskId);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      skipped.push({ taskId: null, theme: '', taskName: '', reason: 'UNKNOWN_TASK', message: SKIP.UNKNOWN_TASK });
      continue;
    }
    if (seen.has(taskId)) continue; // 前端重复勾选，静默去重
    seen.add(taskId);
    incoming.push({ taskId, remark: String((raw && raw.remark) || '').slice(0, 500), media: Array.isArray(raw && raw.media) ? raw.media : [] });
  }

  const tasks = await loadTasksByIds(incoming.map((i) => i.taskId));
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // 已经打过卡的任务集合（提前查，好让响应里一次性把原因说清楚）
  const alreadyRows = incoming.length
    ? await db.q(
      `SELECT task_id FROM daka_checkin WHERE participant_id = ? AND task_id IN (${incoming.map(() => '?').join(',')})`,
      [participantId, ...incoming.map((i) => i.taskId)]
    )
    : [];
  const already = new Set(alreadyRows.map((r) => r.task_id));

  const accepted = [];   // 待写入
  for (const item of incoming) {
    const task = taskMap.get(item.taskId);
    if (!task) {
      skipped.push({ taskId: item.taskId, theme: '', taskName: '', reason: 'UNKNOWN_TASK', message: SKIP.UNKNOWN_TASK });
      continue;
    }
    const brief = { taskId: task.id, theme: task.theme, taskName: task.task_name };

    if (!inWindow) {
      skipped.push({ ...brief, reason: 'ACTIVITY_CLOSED', message: SKIP.ACTIVITY_CLOSED });
      continue;
    }
    if (task.day_date !== date) {
      skipped.push({ ...brief, reason: 'NOT_TODAY', message: `这是 ${task.day_date} 的任务，今天不能打卡` });
      continue;
    }
    if (already.has(task.id)) {
      skipped.push({ ...brief, reason: 'DUPLICATE', message: SKIP.DUPLICATE });
      continue;
    }

    // ---- 凭证校验：照片必填、视频选填 ----
    const photos = item.media.filter((m) => m && m.type === 'image' && m.key);
    const videos = item.media.filter((m) => m && m.type === 'video' && m.key);

    if (!photos.length) {
      // 这就是「提交空白任务」——自动过滤掉，不写库
      skipped.push({ ...brief, reason: 'NO_PHOTO', message: SKIP.NO_PHOTO });
      continue;
    }
    if (photos.length > config.upload.photoMaxCount) {
      skipped.push({ ...brief, reason: 'TOO_MANY_PHOTO', message: SKIP.TOO_MANY_PHOTO });
      continue;
    }
    if (videos.length > config.upload.videoMaxCount) {
      skipped.push({ ...brief, reason: 'TOO_MANY_VIDEO', message: SKIP.TOO_MANY_VIDEO });
      continue;
    }

    accepted.push({
      task,
      brief,
      remark: item.remark,
      media: [...photos.slice(0, config.upload.photoMaxCount), ...videos.slice(0, config.upload.videoMaxCount)],
    });
  }

  if (!accepted.length) {
    return {
      replay: false,
      date,
      accepted: [],
      skipped,
      message: skipped.length
        ? '这次提交没有新增打卡：' + describeSkipped(skipped)
        : '没有可提交的内容',
      progress: await progress(participantId),
    };
  }

  // ---------- 3. 校验凭证归属（文件必须是我们签发的、且属于本人、且未被占用）----------
  const allKeys = accepted.flatMap((a) => a.media.map((m) => String(m.key)));
  const mediaRows = allKeys.length
    ? await db.q(
      `SELECT * FROM daka_media WHERE object_key IN (${allKeys.map(() => '?').join(',')})`,
      allKeys
    )
    : [];
  const mediaMap = new Map(mediaRows.map((m) => [m.object_key, m]));

  const validAccepted = [];
  for (const a of accepted) {
    const okMedia = [];
    let bad = false;
    for (const m of a.media) {
      const row = mediaMap.get(String(m.key));
      if (!row || row.participant_id !== participantId || row.batch_id !== null) { bad = true; break; }
      okMedia.push(row);
    }
    if (bad || !okMedia.length) {
      skipped.push({ ...a.brief, reason: 'BAD_MEDIA', message: SKIP.BAD_MEDIA });
      continue;
    }
    validAccepted.push({ ...a, mediaRows: okMedia });
  }

  if (!validAccepted.length) {
    return {
      replay: false, date, accepted: [], skipped,
      message: '这次提交没有新增打卡：' + describeSkipped(skipped),
      progress: await progress(participantId),
    };
  }

  // ---------- 4. 落库（一个事务，要么全成要么全不成）----------
  const photoCount = validAccepted.reduce((n, a) => n + a.mediaRows.filter((m) => m.media_type === 'image').length, 0);
  const videoCount = validAccepted.reduce((n, a) => n + a.mediaRows.filter((m) => m.media_type === 'video').length, 0);

  const result = await db.tx(async (c) => {
    const batchId = await c.insert(
      `INSERT INTO daka_batch
         (request_id, participant_id, checkin_date, item_count, photo_count, video_count, remark, client_ip, ua)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        requestId, participantId, date, validAccepted.length, photoCount, videoCount,
        String(payload.remark || '').slice(0, 500) || null,
        (meta.ip || '').slice(0, 45) || null,
        (meta.ua || '').slice(0, 255) || null,
      ]
    );

    const done = [];
    for (const a of validAccepted) {
      try {
        await c.insert(
          `INSERT INTO daka_checkin
             (batch_id, participant_id, checkin_date, task_id, theme, task_name, is_offline, remark)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            batchId, participantId, date, a.task.id, a.task.theme, a.task.task_name,
            a.task.is_offline ? 1 : 0, a.remark || null,
          ]
        );
      } catch (e) {
        if (e && e.code === 'ER_DUP_ENTRY') {
          // 极端并发：另一个请求刚插进去了。跳过，不算失败。
          skipped.push({ ...a.brief, reason: 'DUPLICATE', message: SKIP.DUPLICATE });
          continue;
        }
        throw e;
      }

      // 绑定凭证：task_id 由服务端写入权威值，不信任上传时前端声明的归属
      const ids = a.mediaRows.map((m) => m.id);
      await c.exec(
        `UPDATE daka_media SET batch_id = ?, task_id = ?, status = 1 WHERE id IN (${ids.map(() => '?').join(',')})`,
        [batchId, a.task.id, ...ids]
      );
      done.push(a.brief);
    }

    // 全部被并发挤掉 → 这个批次是空的，删掉不留垃圾
    if (!done.length) {
      await c.exec('DELETE FROM daka_batch WHERE id = ?', [batchId]);
      return { batchId: null, done };
    }
    if (done.length !== validAccepted.length) {
      // 部分被并发挤掉：把批次上的计数改成真实落库的数量，别让统计虚高
      const doneIds = new Set(done.map((d) => d.taskId));
      const kept = validAccepted.filter((a) => doneIds.has(a.task.id));
      await c.exec(
        'UPDATE daka_batch SET item_count = ?, photo_count = ?, video_count = ? WHERE id = ?',
        [
          done.length,
          kept.reduce((n, a) => n + a.mediaRows.filter((m) => m.media_type === 'image').length, 0),
          kept.reduce((n, a) => n + a.mediaRows.filter((m) => m.media_type === 'video').length, 0),
          batchId,
        ]
      );
    }
    return { batchId, done };
  });

  const progressData = await progress(participantId);

  return {
    replay: false,
    date,
    batchId: result.batchId,
    accepted: result.done,
    skipped,
    message: result.done.length === 1
      ? `打卡成功：${result.done[0].theme} · ${result.done[0].taskName}`
      : `打卡成功，本次记 ${result.done.length} 项：${result.done.map((d) => d.theme).join('、')}`,
    progress: progressData,
  };
}

function describeSkipped(skipped) {
  const parts = [];
  const dup = skipped.filter((s) => s.reason === 'DUPLICATE');
  const noPhoto = skipped.filter((s) => s.reason === 'NO_PHOTO');
  const notToday = skipped.filter((s) => s.reason === 'NOT_TODAY');
  const bad = skipped.filter((s) => s.reason === 'BAD_MEDIA');
  if (dup.length) parts.push(`${dup.map((s) => s.theme).join('、')} 今天已经打过了`);
  if (noPhoto.length) parts.push(`${noPhoto.map((s) => s.theme).join('、')} 忘了传照片`);
  if (notToday.length) parts.push(`${notToday.map((s) => s.theme).join('、')} 不在今天的任务里`);
  if (bad.length) parts.push(`${bad.map((s) => s.theme).join('、')} 的照片没传成功，请重新上传`);
  return parts.join('；') || '内容不完整';
}

/**
 * 个人进度：累计次数、主题覆盖、荣誉达标情况。
 * 全部现算，不存冗余字段 —— 1000 人规模下这点聚合开销可以忽略，
 * 但没有冗余字段就不会出现"统计对不上"的经典问题。
 */
async function progress(participantId) {
  const [totalRow, themeRows, dayRow] = await Promise.all([
    db.one('SELECT COUNT(*) AS n FROM daka_checkin WHERE participant_id = ?', [participantId]),
    db.q('SELECT theme, COUNT(*) AS n FROM daka_checkin WHERE participant_id = ? GROUP BY theme', [participantId]),
    db.one('SELECT COUNT(DISTINCT checkin_date) AS n FROM daka_checkin WHERE participant_id = ?', [participantId]),
  ]);

  const themeMap = {};
  themeRows.forEach((r) => { themeMap[r.theme] = Number(r.n); });
  const total = Number(totalRow ? totalRow.n : 0);
  const themesHit = Object.keys(themeMap).length;

  const honors = [];
  if (themesHit >= 7) honors.push({ key: 'allThemes', name: '全能少年', desc: '7 个主题每个至少完成 1 次' });
  if (total >= config.activity.hzDakaMaster) honors.push({ key: 'dakaMaster', name: '打卡达人', desc: `累计有效打卡 ≥ ${config.activity.hzDakaMaster} 次` });
  const stars = Object.entries(themeMap).filter(([, n]) => n >= config.activity.hzThemeStar).map(([t]) => t);
  if (stars.length) honors.push({ key: 'themeStar', name: `主题之星（${stars.join('、')}）`, desc: `单个主题完成 ≥ ${config.activity.hzThemeStar} 次` });

  return {
    total,
    days: Number(dayRow ? dayRow.n : 0),
    themesHit,
    themeCount: themeMap,
    honors,
    nextHonor: buildNextHonor(total, themesHit, themeMap),
  };
}

function buildNextHonor(total, themesHit, themeMap) {
  const gaps = [];
  if (themesHit < 7) gaps.push({ name: '全能少年', need: `还差 ${7 - themesHit} 个主题`, remain: 7 - themesHit });
  if (total < config.activity.hzDakaMaster) gaps.push({ name: '打卡达人', need: `还差 ${config.activity.hzDakaMaster - total} 次`, remain: config.activity.hzDakaMaster - total });
  const starGaps = Object.entries(themeMap)
    .filter(([, n]) => n > 0 && n < config.activity.hzThemeStar)
    .map(([t, n]) => ({ theme: t, remain: config.activity.hzThemeStar - n }));
  if (!starGaps.length) {
    const untouched = ['专注', '乐观', '希望', '自信', '感恩', '坚韧', '活力'].filter((t) => !themeMap[t]);
    if (untouched.length) gaps.push({ name: '主题之星', need: `${untouched[0]} 还没开始`, remain: config.activity.hzThemeStar });
  } else {
    gaps.push({ name: '主题之星', need: `${starGaps[0].theme} 还差 ${starGaps[0].remain} 次`, remain: starGaps[0].remain });
  }
  gaps.sort((a, b) => a.remain - b.remain);
  return gaps[0] || null;
}

module.exports = { submit, progress, SKIP, MAX_ITEMS_PER_SUBMIT };
