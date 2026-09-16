'use strict';

/**
 * 参与者端接口（开放 + 需登录）。
 *
 * 命名约定：/api/me** 一律需要参与者 token；
 * 其余为公开接口，但绝不返回任何个人信息。
 */

const Router = require('@koa/router');
const fs = require('fs/promises');
const path = require('path');
const { safeUnlink } = require('../fsx');

const db = require('../db');
const time = require('../time');
const http = require('../http');
const config = require('../config');
const auth = require('../auth');
const stats = require('../services/stats');
const settings = require('../services/settings');
const gallery = require('../services/gallery');
const participantService = require('../services/participant');
const checkinService = require('../services/checkin');
const magic = require('../services/magic');
const transcode = require('../services/transcode');
const { getStorage, buildObjectKey, extFromMime } = require('../storage');
const { rateLimit } = require('../middleware/error');

const router = new Router({ prefix: '/api' });

// ------------------------------------------------------------------ 健康检查

router.get('/health', async (ctx) => {
  let dbInfo = null;
  let dbError = null;
  try {
    dbInfo = await db.health();
  } catch (e) {
    dbError = `${e.code || ''} ${e.message}`.trim();
  }
  const storage = getStorage();
  http.ok(ctx, {
    serverTime: time.nowStr(),
    today: time.today(),
    // 演练模式下前端要打醒目的横幅，免得被当成真实打卡入口
    simulated: time.isSimulated() ? time.today() : null,
    db: dbInfo
      ? { ok: true, version: dbInfo.version, database: dbInfo.db, charset: dbInfo.cs, now: dbInfo.now }
      : { ok: false, error: dbError },
    storage: { driver: storage.name, qiniuReady: storage.name === 'qiniu' ? storage.ready() : null },
    env: config.env,
  });
});

// ------------------------------------------------------------------ 活动信息

router.get('/activity', async (ctx) => {
  http.ok(ctx, await settings.publicActivity());
});

/** 完整任务字典：7 天 × 7 主题。前端一次性取走做缓存 */
router.get('/tasks', async (ctx) => {
  const rows = await db.q(
    `SELECT id, day_date, day_no, weekday, theme, task_name, task_desc, task_how,
            is_offline, offline_point, sort_no
       FROM daka_task ORDER BY day_date, sort_no`
  );
  const byDate = new Map();
  rows.forEach((r) => {
    if (!byDate.has(r.day_date)) {
      byDate.set(r.day_date, {
        date: r.day_date,
        dayNo: r.day_no,
        weekday: r.weekday || time.weekdayOf(r.day_date),
        offlinePoint: r.offline_point || '',
        tasks: [],
      });
    }
    const day = byDate.get(r.day_date);
    if (r.is_offline && r.offline_point && !day.offlinePoint) day.offlinePoint = r.offline_point;
    day.tasks.push({
      id: r.id,
      theme: r.theme,
      name: r.task_name,
      desc: r.task_desc,
      how: r.task_how,
      isOffline: !!r.is_offline,
      offlinePoint: r.offline_point || '',
      sortNo: r.sort_no,
    });
  });
  http.ok(ctx, { themes: stats.THEMES, days: [...byDate.values()] });
});

// ------------------------------------------------------------------ 登记

async function doRegister(ctx) {
  const body = ctx.request.body || {};
  const name = http.pick(body, 'name', { required: true, max: 16 });
  const phone = http.pick(body, 'phone', { required: true, max: 11 });
  const school = http.pick(body, 'school', { required: true, max: 100 });
  const className = http.pick(body, 'className', { max: 30 });

  const r = await participantService.registerOrFind({ name, school, phone, className });
  const token = auth.signParticipant(r.participant);

  http.ok(ctx, {
    token,
    isNew: r.isNew,
    participant: participantService.publicParticipant(r.participant),
    siblings: r.siblings,
    sameName: r.sameName,
    message: r.isNew
      ? '登记完成，之后每天打卡不用再填这些信息'
      : '已找到你的登记信息，继续打卡吧',
  });
}

router.post('/participant/register',
  rateLimit({ windowMs: 60000, max: 20, message: '登记太频繁了，请稍后再试' }),
  doRegister);

// 找回 = 用同样的手机号+姓名再登记一次，语义上给个独立入口更清楚
router.post('/participant/login',
  rateLimit({ windowMs: 60000, max: 20, message: '操作太频繁了，请稍后再试' }),
  async (ctx) => {
    const body = ctx.request.body || {};
    const name = http.pick(body, 'name', { required: true, max: 16 });
    http.assertPhone(http.pick(body, 'phone', { required: true, max: 11 }));
    const found = await db.one(
      'SELECT * FROM daka_participant WHERE phone = ? AND name = ?',
      [String(body.phone).trim(), name]
    );
    if (!found) {
      throw http.notFound('没有找到这条登记信息。可能是姓名或手机号和登记时不一致，也可以直接重新登记。', 'NOT_REGISTERED');
    }
    http.ok(ctx, {
      token: auth.signParticipant(found),
      isNew: false,
      participant: participantService.publicParticipant(found),
      message: '欢迎回来',
    });
  });

// ------------------------------------------------------------------ 我的

router.get('/me', auth.requireParticipant, async (ctx) => {
  const p = await participantService.getById(ctx.state.participantId);
  if (!p) throw http.unauth('登记信息不存在，请重新登记');
  const [progress, today] = await Promise.all([
    checkinService.progress(p.id),
    participantService.todayTasks(p.id),
  ]);
  http.ok(ctx, {
    participant: participantService.publicParticipant(p),
    progress,
    today,
  });
});

router.put('/me', auth.requireParticipant, async (ctx) => {
  const body = ctx.request.body || {};
  const school = http.pick(body, 'school', { required: true, max: 128 });
  await db.exec('UPDATE daka_participant SET school = ? WHERE id = ?', [school, ctx.state.participantId]);
  const p = await participantService.getById(ctx.state.participantId);
  http.ok(ctx, { participant: participantService.publicParticipant(p), message: '已更新' });
});

router.get('/me/tasks', auth.requireParticipant, async (ctx) => {
  const date = require('../sql').date(ctx.query.date, '');
  http.ok(ctx, await participantService.todayTasks(ctx.state.participantId, date || undefined));
});

router.get('/me/records', auth.requireParticipant, async (ctx) => {
  const origin = `${ctx.protocol}://${ctx.host}`;
  http.ok(ctx, await participantService.myRecords(ctx.state.participantId, { origin }));
});

// ------------------------------------------------------------ 上传凭证

/** 上传参数（大小、张数、格式）随时间可变，单独给一个接口，前端进上传页先拉一次 */
router.get('/upload/limits', async (ctx) => {
  const m = await settings.all();
  const storage = getStorage();
  http.ok(ctx, {
    driver: storage.name,
    photo: { maxMB: Number(m.photo_max_mb), maxCount: Number(m.photo_max_count), mime: config.upload.imageMime },
    video: { maxMB: Number(m.video_max_mb), maxCount: Number(m.video_max_count), maxSec: Number(m.video_max_sec), mime: config.upload.videoMime },
  });
});

/**
 * 申请上传凭证。
 * 关键：先在 daka_media 里占一行（status=0），再发凭证。
 * 这样"传上去了但表单没提交"的孤儿文件是**可枚举的**，
 * 而不是只能靠时间戳在存储桶里猜哪些没人要。
 */
router.post('/upload/ticket', auth.requireParticipant, rateLimit({ windowMs: 60000, max: 120 }), async (ctx) => {
  const body = ctx.request.body || {};
  const type = http.pick(body, 'type', { required: true, max: 8 });
  if (type !== 'image' && type !== 'video') throw http.bad('上传类型只能是 image 或 video', 'BAD_TYPE');

  const m = await settings.all();
  const mime = String(body.mime || '').toLowerCase();
  const size = Number(body.size) || 0;
  const isVideo = type === 'video';
  const maxBytes = (isVideo ? Number(m.video_max_mb) : Number(m.photo_max_mb)) * 1024 * 1024;

  if (size > maxBytes) {
    throw http.bad(`文件太大了（${(size / 1048576).toFixed(1)}MB），请压缩后再上传，上限 ${isVideo ? m.video_max_mb : m.photo_max_mb}MB`, 'FILE_TOO_LARGE');
  }
  const allowed = isVideo ? config.upload.videoMime : config.upload.imageMime;
  if (mime && !allowed.includes(mime)) {
    throw http.bad(isVideo ? '请上传 mp4 / mov 格式的视频' : '请上传 jpg / png / heic 格式的照片', 'BAD_MIME');
  }

  const ext = extFromMime(mime) || (isVideo ? 'mp4' : 'jpg');
  const key = buildObjectKey({
    date: time.today(),
    participantId: ctx.state.participantId,
    mediaType: type,
    ext,
  });

  // 前端可以声明这份凭证属于哪一题，方便上传页自己分组预览；
  // 但这只是"意向"，最终归属以提交时的 items[].taskId 为准（见 checkin.js）
  let taskId = Number(body.taskId) || null;
  if (taskId) {
    const t = await db.one('SELECT id FROM daka_task WHERE id = ? AND day_date = ?', [taskId, time.today()]);
    taskId = t ? t.id : null;
  }

  const mediaId = await db.insert(
    `INSERT INTO daka_media
       (participant_id, task_id, media_type, storage, object_key, file_name, file_size, mime, status, sort_no)
     VALUES (?,?,?,?,?,?,?,?,0,?)`,
    [
      ctx.state.participantId, taskId, type, getStorage().name, key,
      String(body.fileName || '').slice(0, 255) || null, size, mime || null,
      require('../sql').int(body.sortNo, 0, { min: 0, max: 20 }),
    ]
  );

  const ticket = getStorage().createUploadTicket({ key, mediaType: type });

  http.ok(ctx, {
    mediaId,
    key,
    type,
    mode: ticket.mode,
    token: ticket.token,
    uploadHost: ticket.uploadHost,
    uploadUrl: ticket.uploadUrl,
    maxBytes,
    expiresIn: ticket.expiresIn,
    // 私有空间下这个预览地址会失效，前端预览请统一走 /api/me/records 拿签名链接
    previewUrl: ticket.previewUrl || '',
  });
});

/**
 * 本地驱动专用：服务器中转接收文件。
 * key 走 query 而不是 body —— multipart 解析后普通字段的顺序不可靠，
 * 而 key 必须与前面登记的 daka_media 行严格对应，所以直接从 query 取，
 * 并且只允许写"库里已登记且属于本人"的 key（天然免疫路径穿越）。
 */
router.post('/upload/local', auth.requireParticipant, rateLimit({ windowMs: 60000, max: 120 }), async (ctx) => {
  const storage = getStorage();
  if (storage.name !== 'local') throw http.bad('当前使用云端存储，请改用直传方式', 'WRONG_DRIVER');

  let key = String(ctx.query.key || '');
  if (!key) throw http.bad('缺少上传标识', 'MISSING_KEY');

  const row = await db.one(
    'SELECT * FROM daka_media WHERE object_key = ? AND participant_id = ?',
    [key, ctx.state.participantId]
  );
  if (!row) throw http.bad('上传标识无效，请重新选择文件', 'BAD_KEY');
  if (row.status !== 0 || row.batch_id !== null) throw http.bad('这个文件已经提交过了', 'ALREADY_USED');

  const f = ctx.request.files && (ctx.request.files.file || Object.values(ctx.request.files)[0]);
  const file = Array.isArray(f) ? f[0] : f;
  if (!file) throw http.bad('没有收到文件', 'NO_FILE');

  /**
   * multipart 解析成功不等于文件真的落到了盘上。
   * formidable v2 在 uploadDir 不存在（或磁盘满）时，写流会静默失败，
   * parse 仍返回成功、`file.filepath` 照样有值 —— 直接 open 就变成一个
   * 毫无线索的 500。所以这里先确认文件在，不在就给一句能指导用户动作的话。
   */
  let tmpStat = null;
  try {
    tmpStat = await fs.stat(file.filepath);
  } catch (e) {
    throw http.bad('文件没有传完整，请检查网络后重新上传', 'UPLOAD_INCOMPLETE');
  }
  if (!tmpStat.size) {
    await safeUnlink(file.filepath);
    throw http.bad('这个文件是空的，请重新选择', 'EMPTY_FILE');
  }

  // 先读文件头核对真实类型，再决定要不要落盘
  const fh = await fs.open(file.filepath, 'r');
  let head;
  try {
    head = Buffer.alloc(16);
    await fh.read(head, 0, 16, 0);
  } finally {
    await fh.close();
  }

  let detected;
  try {
    detected = magic.assert(head, row.media_type);
  } catch (e) {
    await safeUnlink(file.filepath);
    throw http.bad(e.message, e.code || 'BAD_FILE_TYPE');
  }

  const stat = await fs.stat(file.filepath);
  const maxBytes = (row.media_type === 'video'
    ? Number(await settings.num('video_max_mb'))
    : Number(await settings.num('photo_max_mb'))) * 1024 * 1024;
  if (stat.size > maxBytes) {
    await safeUnlink(file.filepath);
    throw http.bad(`文件超过 ${(maxBytes / 1048576).toFixed(0)}MB 上限`, 'FILE_TOO_LARGE');
  }

  let buf = await fs.readFile(file.filepath);
  let finalMime = detected.mime;

  // 服务端视频转码兜底：local 驱动下文件过我们服务器，
  // 若客户端没压（如微信内置浏览器不支持 MediaRecorder 录制 MP4），这里再转一道。
  // 任何失败都保留原片，绝不让上传失败。
  if (row.media_type === 'video' && config.transcode.enabled) {
    try {
      const tc = await transcode.transcodeVideoBuffer(buf);
      if (tc) {
        buf = tc.buffer;
        finalMime = tc.mime; // 一定是 video/mp4
        // mp4 内容配 .mov/.quicktime 扩展名会让媒体中间件回错的 Content-Type，
        // 统一把 key 扩展名改成 .mp4（仅当原本不是 mp4 时）
        const ext = path.extname(key).toLowerCase();
        if (ext && ext !== '.mp4') {
          key = `${key.slice(0, -ext.length)}.mp4`;
        }
        console.log(`[upload/local] 视频服务端转码压缩：${key} ${(stat.size / 1048576).toFixed(1)}MB → ${(buf.length / 1048576).toFixed(1)}MB`);
      }
    } catch (e) {
      // 兜底：转码异常不影响主流程
    }
  }

  const saved = await storage.saveBuffer(key, buf);
  // 删临时文件：Windows 上 formidable 的写流句柄可能还没放开，
  // 一次 unlink 会 EBUSY 失败，必须带退避重试（见 fsx.safeUnlink）
  await safeUnlink(file.filepath);

  await db.exec(
    'UPDATE daka_media SET file_size = ?, mime = ?, object_key = ?, file_name = COALESCE(file_name, ?) WHERE id = ?',
    [saved.size, finalMime, key, String(file.originalFilename || '').slice(0, 255) || null, row.id]
  );

  const origin = `${ctx.protocol}://${ctx.host}`;
  http.ok(ctx, {
    mediaId: row.id,
    key,
    type: row.media_type,
    size: saved.size,
    mime: finalMime,
    previewUrl: storage.publicUrl(key, { origin }),
  });
});

// ------------------------------------------------------------------ 提交打卡

router.post('/checkin', auth.requireParticipant, rateLimit({ windowMs: 60000, max: 40 }), async (ctx) => {
  const result = await checkinService.submit(ctx.state.participantId, ctx.request.body || {}, {
    ip: ctx.ip,
    ua: ctx.get('user-agent'),
  });
  http.ok(ctx, result);
});

// -------------------------------------------------- 清城少年立志瞬间（照片墙）

/**
 * 首页「清城少年立志瞬间」。
 * 公开接口，所以只回脱敏姓名 + 主题 + 照片直链，不给学校、手机号、留言。
 * 后台可以一键关掉（gallery_public），关掉后前端整块不渲染。
 */
router.get('/gallery', async (ctx) => {
  if (!(await settings.bool('gallery_public'))) {
    throw http.forbidden('活动方暂未公开打卡照片', 'GALLERY_CLOSED');
  }
  const origin = `${ctx.protocol}://${ctx.host}`;
  http.ok(ctx, await gallery.recentPhotos(require('../sql').int(ctx.query.limit, 30, { min: 5, max: 60 }), { origin }));
});

/** 刷新媒体签名链接（私有空间 2 小时过期，页面放久了需要重取） */
router.post('/media/urls', auth.requireParticipant, async (ctx) => {
  const keys = Array.isArray(ctx.request.body && ctx.request.body.keys) ? ctx.request.body.keys : [];
  if (!keys.length) throw http.bad('缺少文件标识', 'MISSING_KEYS');
  if (keys.length > 60) throw http.bad('一次最多刷新 60 个链接', 'TOO_MANY_KEYS');

  // 只给本人用过的 key，防止被拿来给任意 key 签名
  const rows = await db.q(
    `SELECT DISTINCT object_key FROM daka_media
      WHERE participant_id = ? AND object_key IN (${keys.map(() => '?').join(',')})`,
    [ctx.state.participantId, ...keys.map((k) => String(k).slice(0, 255))]
  );
  const storage = getStorage();
  const origin = `${ctx.protocol}://${ctx.host}`;
  const out = {};
  rows.forEach((r) => {
    out[r.object_key] = storage.mediaUrl(r.object_key, { origin, expiresIn: 7200 });
  });
  http.ok(ctx, { urls: out });
});

module.exports = router;
