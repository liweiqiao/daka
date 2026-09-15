'use strict';

/**
 * 参与者：登记 / 找回 / 我的记录。
 *
 * 关于「重名」的处理（需求第 6 条）：
 *   系统的唯一标识是自增 id，姓名从来不是标识。
 *   业务身份用 (手机号 + 姓名) 唯一键：
 *     - 同一家长给两个孩子报名 → 同手机号 + 不同姓名 → 两条记录，互不干扰
 *     - 两个孩子重名但在不同家庭 → 不同手机号 + 同姓名 → 两条记录，靠手机号区分
 *     - 同一家长重复登记同一个孩子 → 命中唯一键 → 直接返回已有记录，不新增
 *   同时把"同名人数"回给前端，让家长自己确认一下有没有填错手机号。
 */

const db = require('../db');
const http = require('../http');
const stats = require('./stats');
const checkinService = require('./checkin');
const config = require('../config');
const { getStorage } = require('../storage');

/**
 * 登记或找回。
 * 返回 { participant, token, isNew, siblings, sameName }
 */
async function registerOrFind({ name, school, phone, className }) {
  const cleanName = http.assertName(name);
  http.assertPhone(phone);
  const cleanSchool = [school, className].filter(Boolean).join(' ').trim().slice(0, 128);
  if (!cleanSchool) throw http.bad('请填写学校', 'MISSING_FIELD', { field: 'school' });

  const existing = await db.one(
    'SELECT * FROM daka_participant WHERE phone = ? AND name = ?',
    [phone, cleanName]
  );

  if (existing) {
    // 学校换了就顺手更新，避免家长打错字后一直将错就错去印证书
    if (existing.school !== cleanSchool) {
      await db.exec(
        'UPDATE daka_participant SET school = ? WHERE id = ? AND school <> ?',
        [cleanSchool, existing.id, cleanSchool]
      );
      existing.school = cleanSchool;
    }
    return {
      participant: existing,
      isNew: false,
      siblings: await siblingCount(phone, existing.id),
      sameName: await sameNameInfo(cleanName, existing.id),
    };
  }

  const id = await db.insert(
    'INSERT INTO daka_participant (phone, name, school) VALUES (?,?,?)',
    [phone, cleanName, cleanSchool]
  );

  return {
    participant: { id, phone, name: cleanName, school: cleanSchool },
    isNew: true,
    siblings: await siblingCount(phone, id),
    sameName: await sameNameInfo(cleanName, id),
  };
}

async function siblingCount(phone, excludeId) {
  const r = await db.one(
    'SELECT COUNT(*) AS n FROM daka_participant WHERE phone = ? AND id <> ?',
    [phone, excludeId]
  );
  return Number(r.n);
}

async function sameNameInfo(name, excludeId) {
  const rows = await db.q(
    'SELECT id, school, phone FROM daka_participant WHERE name = ? AND id <> ?',
    [name, excludeId]
  );
  return {
    count: rows.length,
    // 只回学校，不回手机号 —— 前端拿到的是别人家孩子的信息，越少越好
    schools: [...new Set(rows.map((r) => r.school))].slice(0, 5),
  };
}

async function getById(id) {
  return db.one('SELECT id, name, school, phone, created_at FROM daka_participant WHERE id = ?', [id]);
}

function publicParticipant(p) {
  return {
    id: p.id,
    name: p.name,
    school: p.school,
    phone: stats.maskPhone(p.phone),
    phoneRaw: p.phone,
    registeredAt: p.created_at,
  };
}

/**
 * 我的打卡记录：按日期倒序分组，每项带上凭证链接。
 * 需求第 2 条「用户提交后可以自行查看提交记录」。
 */
async function myRecords(participantId, { origin } = {}) {
  const rows = await db.q(
    `SELECT c.id, c.batch_id, c.checkin_date, c.task_id, c.theme, c.task_name, c.is_offline, c.remark, c.created_at,
            b.item_count, b.photo_count, b.video_count
       FROM daka_checkin c
       JOIN daka_batch b ON b.id = c.batch_id
      WHERE c.participant_id = ?
      ORDER BY c.checkin_date DESC, c.id DESC`,
    [participantId]
  );

  if (!rows.length) return { days: [], total: 0 };

  const batchIds = [...new Set(rows.map((r) => r.batch_id))];
  const media = await db.q(
    `SELECT id, batch_id, task_id, media_type, object_key, file_size, mime, duration, sort_no
       FROM daka_media
      WHERE batch_id IN (${batchIds.map(() => '?').join(',')}) AND status = 1
      ORDER BY media_type, sort_no, id`,
    batchIds
  );

  const storage = getStorage();
  // 按 (批次, 任务) 归组：一个批次可能含多个主题，照片要能对回各自的主题
  const bucketKey = (batchId, taskId) => `${batchId}|${taskId || 0}`;
  const byBucket = new Map();
  media.forEach((m) => {
    const k = bucketKey(m.batch_id, m.task_id);
    if (!byBucket.has(k)) byBucket.set(k, { images: [], videos: [] });
    const bucket = byBucket.get(k);
    const item = {
      key: m.object_key,
      url: storage.mediaUrl(m.object_key, { origin, expiresIn: 7200 }),
      size: Number(m.file_size),
      mime: m.mime,
      duration: m.duration,
    };
    if (m.media_type === 'image') bucket.images.push(item);
    else bucket.videos.push(item);
  });

  const dayMap = new Map();
  rows.forEach((r) => {
    if (!dayMap.has(r.checkin_date)) {
      dayMap.set(r.checkin_date, {
        date: r.checkin_date,
        weekday: require('../time').weekdayOf(r.checkin_date),
        items: [],
      });
    }
    const m = byBucket.get(bucketKey(r.batch_id, r.task_id)) || { images: [], videos: [] };
    dayMap.get(r.checkin_date).items.push({
      checkinId: r.id,
      batchId: r.batch_id,
      taskId: r.task_id,
      theme: r.theme,
      taskName: r.task_name,
      isOffline: !!r.is_offline,
      remark: r.remark || '',
      createdAt: r.created_at,
      images: m.images,
      videos: m.videos,
    });
  });

  const days = [...dayMap.values()];
  days.forEach((d) => {
    d.count = d.items.length;
    d.photos = d.items.reduce((n, i) => n + i.images.length, 0);
    d.videos = d.items.reduce((n, i) => n + i.videos.length, 0);
  });

  return { days, total: rows.length, progress: await checkinService.progress(participantId) };
}

/** 今天还可以打卡的任务（已打过的标记出来，前端直接置灰） */
async function todayTasks(participantId, date) {
  const day = date || require('../time').today();
  const [tasks, done] = await Promise.all([
    db.q('SELECT * FROM daka_task WHERE day_date = ? ORDER BY sort_no', [day]),
    db.q(
      `SELECT task_id FROM daka_checkin
        WHERE participant_id = ? AND checkin_date = ?`,
      [participantId, day]
    ),
  ]);
  const doneSet = new Set(done.map((d) => d.task_id));
  return {
    date: day,
    weekday: require('../time').weekdayOf(day),
    inActivity: require('../time').diffDays(config.activity.startDate, day) >= 0
      && require('../time').diffDays(day, config.activity.endDate) >= 0,
    tasks: tasks.map((t) => ({
      id: t.id,
      theme: t.theme,
      name: t.task_name,
      desc: t.task_desc,
      how: t.task_how,
      isOffline: !!t.is_offline,
      offlinePoint: t.offline_point || '',
      sortNo: t.sort_no,
      done: doneSet.has(t.id),
    })),
    doneCount: doneSet.size,
    remaining: tasks.length - doneSet.size,
  };
}

module.exports = { registerOrFind, getById, publicParticipant, myRecords, todayTasks, sameNameInfo };
