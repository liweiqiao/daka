'use strict';

/**
 * 后台接口（统计、明细、导出、设置）。
 *
 * 安全基线（这套东西挂着未成年人照片，不能马虎）：
 *   - 除登录外全部要 admin token
 *   - 默认给手机号打码，导出时才给全量
 *   - 删记录、改配置、清文件都写 daka_oplog，谁干的能查到
 */

const Router = require('@koa/router');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = require('../db');
const time = require('../time');
const http = require('../http');
const sql = require('../sql');
const auth = require('../auth');
const config = require('../config');
const stats = require('../services/stats');
const settings = require('../services/settings');
const exporter = require('../services/export');
const { getStorage } = require('../storage');
const { rateLimit } = require('../middleware/error');

const router = new Router({ prefix: '/api/admin' });

// ------------------------------------------------------------------ 日志

async function log(ctx, action, target, detail) {
  try {
    const a = ctx.state.admin;
    await db.insert(
      'INSERT INTO daka_oplog (admin_id, admin_name, action, target, detail, ip) VALUES (?,?,?,?,?,?)',
      [
        a ? a.id : null,
        a ? (a.displayName || a.username) : 'unknown',
        action,
        String(target || '').slice(0, 64),
        String(detail || '').slice(0, 500),
        String(ctx.ip || '').slice(0, 45),
      ]
    );
  } catch (e) {
    // 日志写失败不能影响主流程，但要在服务端留个印子
    ctx.app.emit('error', e, ctx);
  }
}

// ------------------------------------------------------------------ 登录

router.post('/login', rateLimit({ windowMs: 10 * 60000, max: 10, message: '登录尝试过多，请 10 分钟后再试' }), async (ctx) => {
  const body = ctx.request.body || {};
  const username = http.pick(body, 'username', { required: true, max: 32 });
  const password = http.pick(body, 'password', { required: true, max: 64 });

  const admin = await db.one('SELECT * FROM daka_admin WHERE username = ?', [username]);
  // 统一的错误话术，不告诉对方是账号错还是密码错
  const deny = () => http.unauth('账号或密码不正确', 'LOGIN_FAILED');
  if (!admin) throw deny();
  if (!bcrypt.compareSync(password, admin.password_hash)) throw deny();

  await db.exec('UPDATE daka_admin SET last_login_at = NOW() WHERE id = ?', [admin.id]);
  ctx.state.admin = { id: admin.id, username: admin.username, displayName: admin.display_name || admin.username };
  await log(ctx, 'LOGIN', `admin:${admin.username}`, '登录后台');

  http.ok(ctx, {
    token: auth.signAdmin(admin),
    admin: { id: admin.id, username: admin.username, displayName: admin.display_name || admin.username },
  });
});

/** 以下全部需要登录 */
router.use(auth.requireAdmin);

router.get('/me', async (ctx) => {
  http.ok(ctx, {
    admin: ctx.state.admin,
    serverTime: time.nowStr(),
    today: time.today(),
    simulated: time.isSimulated() ? time.today() : null,
  });
});

router.post('/password', async (ctx) => {
  const body = ctx.request.body || {};
  const oldPwd = http.pick(body, 'oldPassword', { required: true, max: 64 });
  const newPwd = http.pick(body, 'newPassword', { required: true, max: 64 });
  if (newPwd.length < 8 || !/[a-zA-Z]/.test(newPwd) || !/\d/.test(newPwd)) {
    throw http.bad('新密码至少 8 位，且要同时含字母和数字', 'WEAK_PASSWORD');
  }
  const admin = await db.one('SELECT * FROM daka_admin WHERE id = ?', [ctx.state.admin.id]);
  if (!admin || !bcrypt.compareSync(oldPwd, admin.password_hash)) {
    throw http.bad('原密码不正确', 'BAD_PASSWORD');
  }
  await db.exec('UPDATE daka_admin SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(newPwd, 10), admin.id]);
  await log(ctx, 'PASSWORD', `admin:${admin.username}`, '修改密码');
  http.ok(ctx, { message: '密码已更新，请用新密码重新登录' });
});

// ------------------------------------------------------------------ 概览

router.get('/overview', async (ctx) => {
  const date = sql.date(ctx.query.date, '') || undefined;
  const [ov, daily] = await Promise.all([
    stats.overview(date),
    stats.dailySummary(date),
  ]);
  http.ok(ctx, { overview: ov, daily, storage: { driver: getStorage().name } });
});

router.get('/daily', async (ctx) => {
  const date = sql.date(ctx.query.date, '') || time.today();
  http.ok(ctx, await stats.dailySummary(date));
});

/** 一次把后台首页要的所有图数据取回，减少手机端的请求数 */
router.get('/dashboard', async (ctx) => {
  const date = sql.date(ctx.query.date, '') || time.today();
  const [overviewData, daily, tr, mx, schools, dist, cover, dups, hourly, fun, honorSum] = await Promise.all([
    stats.overview(date),
    stats.dailySummary(date),
    stats.trend(),
    stats.matrix(),
    stats.schoolRank(20),
    stats.dayDistribution(),
    stats.themeCoverage(),
    stats.duplicates(50),
    stats.hourlyDistribution(),
    stats.funnel(),
    stats.honorSummary(),
  ]);
  http.ok(ctx, {
    overview: overviewData,
    daily,
    trend: tr,
    matrix: mx,
    schools,
    dayDistribution: dist,
    themeCoverage: cover,
    duplicates: dups.filter((d) => d.suspicious),
    // 图表口径：后端算好直接给，前端不做二次汇总，
    // 避免"后台看到的数字和导出文件对不上"
    hourly,
    funnel: fun,
    honors: honorSum,
    storage: { driver: getStorage().name },
  });
});

router.get('/trend', async (ctx) => http.ok(ctx, { trend: await stats.trend() }));
router.get('/matrix', async (ctx) => http.ok(ctx, await stats.matrix()));
router.get('/hourly', async (ctx) => http.ok(ctx, await stats.hourlyDistribution()));
router.get('/funnel', async (ctx) => http.ok(ctx, await stats.funnel()));
router.get('/honor-summary', async (ctx) => http.ok(ctx, await stats.honorSummary()));
router.get('/schools', async (ctx) => http.ok(ctx, { schools: await stats.schoolRank(sql.int(ctx.query.limit, 30, { min: 1, max: 200 })) }));

router.get('/honors', async (ctx) => {
  const types = String(ctx.query.types || 'allThemes,dakaMaster,themeStar')
    .split(',').map((s) => s.trim()).filter(Boolean);
  http.ok(ctx, await stats.honors({ types, keyword: String(ctx.query.keyword || '').slice(0, 40) }));
});

router.get('/duplicates', async (ctx) => {
  const list = await stats.duplicates(sql.int(ctx.query.limit, 500, { min: 1, max: 2000 }));
  http.ok(ctx, { duplicates: list, suspicious: list.filter((d) => d.suspicious), groups: list.length });
});

// ------------------------------------------------------------------ 明细

/**
 * 打卡明细（后台主表）。
 * 筛选维度就是活动方实际会用的那几种：日期、主题、学校、姓名/手机号、线下任务。
 */
router.get('/checkins', async (ctx) => {
  const qy = ctx.query;
  const where = ['1=1'];
  const params = [];

  const date = sql.date(qy.date, '');
  if (date) { where.push('c.checkin_date = ?'); params.push(date); }
  const theme = String(qy.theme || '').trim();
  if (theme && stats.THEMES.includes(theme)) { where.push('c.theme = ?'); params.push(theme); }
  const school = String(qy.school || '').trim().slice(0, 60);
  if (school) { where.push('p.school LIKE ?'); params.push(`%${school}%`); }
  const keyword = String(qy.keyword || '').trim().slice(0, 40);
  if (keyword) { where.push('(p.name LIKE ? OR p.phone LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`); }
  if (String(qy.offline || '') === '1') where.push('c.is_offline = 1');
  const pid = Number(qy.participantId);
  if (Number.isInteger(pid) && pid > 0) { where.push('c.participant_id = ?'); params.push(pid); }

  const page = sql.int(qy.page, 1, { min: 1, max: 100000 });
  const pageSize = sql.int(qy.pageSize, 50, { min: 1, max: 200 });
  const offset = (page - 1) * pageSize;

  const whereSql = where.join(' AND ');
  const [totalRow, rows] = await Promise.all([
    db.one(
      `SELECT COUNT(*) AS n FROM daka_checkin c JOIN daka_participant p ON p.id = c.participant_id WHERE ${whereSql}`,
      params
    ),
    db.q(
      `SELECT c.id, c.checkin_date, c.theme, c.task_name, c.is_offline, c.remark, c.created_at,
              p.id AS participant_id, p.name, p.school, p.phone,
              b.id AS batch_id, b.item_count, b.photo_count, b.video_count
         FROM daka_checkin c
         JOIN daka_participant p ON p.id = c.participant_id
         JOIN daka_batch b ON b.id = c.batch_id
        WHERE ${whereSql}
        ORDER BY c.checkin_date DESC, c.id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params
    ),
  ]);

  http.ok(ctx, {
    page,
    pageSize,
    total: Number(totalRow.n),
    pages: Math.ceil(Number(totalRow.n) / pageSize),
    list: rows.map((r) => ({
      id: r.id,
      date: r.checkin_date,
      weekday: time.weekdayOf(r.checkin_date),
      theme: r.theme,
      taskName: r.task_name,
      isOffline: !!r.is_offline,
      remark: r.remark || '',
      createdAt: r.created_at,
      participant: {
        id: r.participant_id,
        name: r.name,
        school: r.school,
        phone: stats.maskPhone(r.phone),
        phoneRaw: r.phone,
      },
      batch: {
        id: r.batch_id,
        itemCount: r.item_count,
        photos: r.photo_count,
        videos: r.video_count,
      },
    })),
  });
});

/** 单条打卡的凭证（后台点开看照片/视频） */
router.get('/checkin/:id/media', async (ctx) => {
  const id = sql.int(ctx.params.id, 0);
  const row = await db.one(
    `SELECT c.batch_id, c.participant_id, c.checkin_date, c.theme, c.task_name,
            p.name, p.school, p.phone
       FROM daka_checkin c JOIN daka_participant p ON p.id = c.participant_id
      WHERE c.id = ${id}`
  );
  if (!row) throw http.notFound('记录不存在');

  const media = await db.q(
    `SELECT id, media_type, object_key, file_size, mime, duration, created_at
       FROM daka_media WHERE batch_id = ? AND status = 1
      ORDER BY media_type, sort_no, id`,
    [row.batch_id]
  );
  const storage = getStorage();
  const origin = `${ctx.protocol}://${ctx.host}`;
  http.ok(ctx, {
    checkin: { ...row, phone: stats.maskPhone(row.phone), phoneRaw: row.phone },
    media: media.map((m) => ({
      id: m.id,
      type: m.media_type,
      key: m.object_key,
      size: Number(m.file_size),
      sizeMB: Number((Number(m.file_size) / 1048576).toFixed(2)),
      mime: m.mime,
      duration: m.duration,
      url: storage.mediaUrl(m.object_key, { origin, expiresIn: 1800 }),
      uploadedAt: m.created_at,
    })),
  });
});

/** 删除一条打卡（家长传错了来求援时用）。明细删掉，凭证回到待绑定状态交给清理任务 */
router.delete('/checkin/:id', async (ctx) => {
  const id = sql.int(ctx.params.id, 0);
  const row = await db.one('SELECT * FROM daka_checkin WHERE id = ?', [id]);
  if (!row) throw http.notFound('记录不存在');

  await db.tx(async (c) => {
    // 只解绑"这一项任务"的凭证。按 media_type 解绑是错的 ——
    // 一个批次里可能同时有多个主题，那样会把别人主题的照片一并扒下来。
    // 媒体台账上的 (participant_id, task_id) 就是这一项的凭证，精确对应。
    await c.exec(
      'UPDATE daka_media SET batch_id = NULL, task_id = NULL, status = 0 WHERE participant_id = ? AND task_id = ?',
      [row.participant_id, row.task_id]
    );
    await c.exec('DELETE FROM daka_checkin WHERE id = ?', [id]);
    const left = await c.one('SELECT COUNT(*) AS n FROM daka_checkin WHERE batch_id = ?', [row.batch_id]);
    if (!Number(left.n)) {
      // 批次空了就删掉；此时它的凭证已经解绑，不会跟着级联删掉
      await c.exec('DELETE FROM daka_batch WHERE id = ?', [row.batch_id]);
    }
  });

  await log(ctx, 'DELETE_CHECKIN', `checkin:${id}`,
    `${row.checkin_date} ${row.theme} ${row.task_name}（participant ${row.participant_id}）`);
  http.ok(ctx, { message: '已删除该条打卡，参与者可以重新提交这一项' });
});

// ------------------------------------------------------------------ 参与者

router.get('/participants', async (ctx) => {
  const qy = ctx.query;
  const where = ['1=1'];
  const params = [];
  const keyword = String(qy.keyword || '').trim().slice(0, 40);
  if (keyword) {
    where.push('(p.name LIKE ? OR p.phone LIKE ? OR p.school LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const school = String(qy.school || '').trim().slice(0, 60);
  if (school) { where.push('p.school LIKE ?'); params.push(`%${school}%`); }
  if (String(qy.idle || '') === '1') where.push('c.id IS NULL');

  const page = sql.int(qy.page, 1, { min: 1, max: 100000 });
  const pageSize = sql.int(qy.pageSize, 50, { min: 1, max: 200 });
  const offset = (page - 1) * pageSize;
  const orderBy = sql.orderBy(qy.orderBy, ['total', 'themes', 'days', 'created_at', 'name', 'school'], 'total');
  const whereSql = where.join(' AND ');

  const [rows, totalRow] = await Promise.all([
    db.q(
      `SELECT p.id, p.name, p.school, p.phone, p.created_at,
              COUNT(c.id) AS total,
              COUNT(DISTINCT c.theme) AS themes,
              COUNT(DISTINCT c.checkin_date) AS days
         FROM daka_participant p
         LEFT JOIN daka_checkin c ON c.participant_id = p.id
        WHERE ${whereSql}
        GROUP BY p.id, p.name, p.school, p.phone, p.created_at
        ORDER BY ${orderBy} DESC, p.id ASC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params
    ),
    db.one(
      `SELECT COUNT(DISTINCT p.id) AS n FROM daka_participant p
        LEFT JOIN daka_checkin c ON c.participant_id = p.id WHERE ${whereSql}`,
      params
    ),
  ]);

  const trueTotal = Number(totalRow.n);

  http.ok(ctx, {
    page,
    pageSize,
    total: trueTotal,
    pages: Math.ceil(trueTotal / pageSize) || 1,
    list: rows.map((r) => ({
      id: r.id,
      name: r.name,
      school: r.school,
      phone: stats.maskPhone(r.phone),
      phoneRaw: r.phone,
      registeredAt: r.created_at,
      total: Number(r.total),
      themes: Number(r.themes),
      days: Number(r.days),
      honors: buildHonorTags(Number(r.total), Number(r.themes)),
    })),
  });
});

function buildHonorTags(total, themes) {
  const tags = [];
  if (themes >= 7) tags.push('全能少年');
  if (total >= config.activity.hzDakaMaster) tags.push('打卡达人');
  return tags;
}

router.get('/participant/:id', async (ctx) => {
  const id = sql.int(ctx.params.id, 0);
  const p = await db.one('SELECT * FROM daka_participant WHERE id = ?', [id]);
  if (!p) throw http.notFound('参与者不存在');
  const [records, progress, sameName] = await Promise.all([
    require('../services/participant').myRecords(id, { origin: `${ctx.protocol}://${ctx.host}` }),
    require('../services/checkin').progress(id),
    db.q('SELECT id, school FROM daka_participant WHERE name = ? AND id <> ?', [p.name, id]),
  ]);
  http.ok(ctx, {
    participant: {
      id: p.id, name: p.name, school: p.school,
      phone: stats.maskPhone(p.phone), phoneRaw: p.phone, registeredAt: p.created_at,
    },
    progress,
    records: records.days,
    sameName: sameName.map((s) => ({ id: s.id, school: s.school })),
  });
});

// ------------------------------------------------------------------ 附件

/** 附件台账：已绑定的 + 待绑定的（孤儿）分开列，方便判断"能不能清空间了" */
router.get('/media', async (ctx) => {
  const qy = ctx.query;
  const status = String(qy.status ?? '1');
  const date = sql.date(qy.date, '');
  const where = [];
  const params = [];

  if (status === '0') {
    where.push('m.status = 0');
    // 时间段直接内联：sql.int 已经把它夹成纯整数，不可能带引号；
    // 而 `INTERVAL ? MINUTE` 在部分 MySQL 版本上会报
    // "Incorrect arguments to mysqld_stmt_execute"，内联最稳。
    const minutes = sql.int(qy.minutes, 120, { min: 1, max: 44640 });
    where.push(`m.created_at < DATE_SUB(NOW(), INTERVAL ${minutes} MINUTE)`);
  } else if (status === 'all') {
    where.push('1=1');
  } else {
    where.push('m.status = 1');
  }
  if (date) { where.push('DATE(m.created_at) = ?'); params.push(date); }

  const page = sql.int(qy.page, 1, { min: 1, max: 100000 });
  const pageSize = sql.int(qy.pageSize, 60, { min: 1, max: 200 });
  const whereSql = where.join(' AND ');

  const [summary, countRow, rows] = await Promise.all([
    db.one(
      `SELECT
         COUNT(*) AS totalCount,
         COALESCE(SUM(m.file_size), 0) AS totalBytes,
         SUM(m.status = 0) AS orphanCount,
         SUM(m.status = 1) AS boundCount,
         COALESCE(SUM(CASE WHEN m.status = 0 THEN m.file_size ELSE 0 END), 0) AS orphanBytes,
         SUM(m.media_type = 'image') AS photos,
         SUM(m.media_type = 'video') AS videos
       FROM daka_media m`
    ),
    // 当前筛选下的条数：分页要用它，不能拿全局 summary.totalCount 充数
    db.one(
      `SELECT COUNT(*) AS n FROM daka_media m
         LEFT JOIN daka_participant p ON p.id = m.participant_id
        WHERE ${whereSql}`,
      params
    ),
    db.q(
      `SELECT m.id, m.media_type, m.object_key, m.file_size, m.mime, m.status, m.created_at,
              m.participant_id, p.name, p.school,
              c.checkin_date, c.theme
         FROM daka_media m
         LEFT JOIN daka_participant p ON p.id = m.participant_id
         LEFT JOIN daka_checkin c
           ON c.participant_id = m.participant_id AND c.task_id = m.task_id
        WHERE ${whereSql}
        ORDER BY m.id DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    ),
  ]);

  const storage = getStorage();
  const origin = `${ctx.protocol}://${ctx.host}`;

  http.ok(ctx, {
    page,
    pageSize,
    total: Number(countRow.n),
    pages: Math.ceil(Number(countRow.n) / pageSize) || 1,
    summary: {
      totalCount: Number(summary.totalCount),
      totalMB: Number((Number(summary.totalBytes) / 1048576).toFixed(1)),
      orphanCount: Number(summary.orphanCount),
      orphanMB: Number((Number(summary.orphanBytes) / 1048576).toFixed(1)),
      boundCount: Number(summary.boundCount),
      photos: Number(summary.photos),
      videos: Number(summary.videos),
    },
    list: rows.map((r) => ({
      id: r.id,
      type: r.media_type,
      key: r.object_key,
      sizeMB: Number((Number(r.file_size) / 1048576).toFixed(2)),
      mime: r.mime,
      status: Number(r.status),
      createdAt: r.created_at,
      participant: r.participant_id ? { id: r.participant_id, name: r.name, school: r.school } : null,
      checkin: r.checkin_date ? { date: r.checkin_date, theme: r.theme } : null,
      url: r.status === 1 ? storage.mediaUrl(r.object_key, { origin, expiresIn: 1800 }) : '',
    })),
  });
});

/**
 * 清理孤儿文件：上传成功但没跟着提交的凭证。
 * 这是「七牛免费 10GB 空间」的关键运维动作 —— 每天导完当天的，
 * 再把没用的清掉，空间就不会累积。
 */
router.post('/media/cleanup', async (ctx) => {
  const body = ctx.request.body || {};
  const hours = sql.int(body.olderThanHours, 24, { min: 1, max: 720 });
  const limit = sql.int(body.limit, 500, { min: 1, max: 2000 });
  const dryRun = body.dryRun === true || body.dryRun === '1';

  const rows = await db.q(
    `SELECT id, object_key, storage, file_size FROM daka_media
      WHERE status = 0 AND batch_id IS NULL
        AND created_at < DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
      ORDER BY id LIMIT ${limit}`
  );

  if (dryRun) {
    http.ok(ctx, {
      dryRun: true,
      candidates: rows.length,
      sizeMB: Number((rows.reduce((n, r) => n + Number(r.file_size), 0) / 1048576).toFixed(1)),
      message: `有 ${rows.length} 个文件可以清理（试运行，未真正删除）`,
    });
    return;
  }

  const storage = getStorage();
  let removed = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      // 只删当前驱动下的文件；驱动切换过的话另一边的文件留给人工处理
      if (r.storage === storage.name) await storage.remove(r.object_key);
      await db.exec('UPDATE daka_media SET status = -1 WHERE id = ?', [r.id]);
      removed += 1;
    } catch (e) {
      failed += 1;
    }
  }

  await log(ctx, 'CLEANUP_MEDIA', `orphan`, `清理 ${removed} 个孤儿文件（失败 ${failed}）`);
  http.ok(ctx, {
    removed,
    failed,
    remain: Math.max(0, rows.length - removed - failed),
    message: `已清理 ${removed} 个未提交的凭证文件${failed ? `，${failed} 个失败` : ''}`,
  });
});

// ------------------------------------------------------------------ 导出

function csvHeaders(ctx, filename) {
  ctx.set('Content-Type', 'text/csv; charset=utf-8');
  ctx.set('Content-Disposition',
    `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  ctx.set('Cache-Control', 'no-store');
}

/**
 * 附件打包下载。
 *
 * 注意：这条必须注册在 `/export/:type` 之前。
 * @koa/router 按注册顺序匹配，`/export/:type` 会把 `/export/media.zip`
 * 当成 type='media.zip' 抢先吃掉，导致打包功能永远返回 400。
 */
router.get('/export/media.zip', async (ctx) => {
  const date = sql.date(ctx.query.date, '') || undefined;
  const maxFiles = sql.int(ctx.query.maxFiles, 300, { min: 1, max: 3000 });
  const origin = `${ctx.protocol}://${ctx.host}`;

  const r = await exporter.mediaZip({ date, maxFiles, origin });
  if (!r.entries) throw http.notFound('这个范围内没有可打包的附件');

  const name = `打卡凭证${date ? `_${date}` : '_全部'}.zip`;
  ctx.set('Content-Type', 'application/zip');
  ctx.set('Content-Disposition',
    `attachment; filename="media.zip"; filename*=UTF-8''${encodeURIComponent(name)}`);
  ctx.set('Cache-Control', 'no-store');
  ctx.set('X-Zip-Entries', String(r.entries));
  ctx.set('X-Zip-Skipped', String(r.skipped));
  ctx.set('X-Zip-Truncated', r.truncated ? '1' : '0');
  ctx.body = r.buffer;

  await log(ctx, 'EXPORT_ZIP', date ? `media:${date}` : 'media:all',
    `打包 ${r.entries} 个附件（跳过 ${r.skipped}），${(r.bytes / 1048576).toFixed(1)}MB`);
});

router.get('/export/:type', async (ctx) => {
  const type = String(ctx.params.type);
  const qy = ctx.query;
  const origin = `${ctx.protocol}://${ctx.host}`;

  const opts = {
    date: sql.date(qy.date, '') || undefined,
    theme: stats.THEMES.includes(String(qy.theme || '')) ? String(qy.theme) : undefined,
    school: String(qy.school || '').slice(0, 60) || undefined,
    keyword: String(qy.keyword || '').slice(0, 40) || undefined,
    participantId: Number(qy.participantId) || undefined,
    origin,
  };

  const { filename, content } = await exporter.build(type, opts);
  csvHeaders(ctx, filename);
  ctx.body = content;
  await log(ctx, 'EXPORT', type, `导出 ${type}（${filename}）`);
});

// ------------------------------------------------------------------ 任务字典

/** 默认任务字典（tasks-data.js 是唯一默认值来源，「恢复默认」按 天+主题 反查） */
const TASK_DEFAULTS = require('../../db/tasks-data');

/** 校验并夹紧任务编辑表单，返回 { error } 或 { value } */
function normalizeTaskBody(body) {
  const theme = String(body.theme || '').trim();
  const name = String(body.name || '').trim();
  const desc = String(body.desc || '').trim();
  const how = String(body.how || '').trim();
  const offlinePoint = String(body.offlinePoint || '').trim();
  const isOffline = body.isOffline === true || body.isOffline === 1 || body.isOffline === '1' || body.isOffline === 'true';

  if (!TASK_DEFAULTS.THEMES.includes(theme)) return { error: '主题不合法' };
  if (!name) return { error: '任务名不能为空' };
  if (name.length > 64) return { error: '任务名最多 64 字' };
  if (desc.length > 255) return { error: '玩法最多 255 字' };
  if (how.length > 255) return { error: '打卡要求最多 255 字' };
  if (offlinePoint.length > 32) return { error: '线下打卡点名称最多 32 字' };
  return { value: { theme, name, desc, how, isOffline, offlinePoint: isOffline ? offlinePoint : '' } };
}

router.get('/tasks', async (ctx) => {
  const rows = await db.q(
    `SELECT t.*,
            (SELECT COUNT(*) FROM daka_checkin c WHERE c.task_id = t.id) AS doneCount
       FROM daka_task t ORDER BY t.day_date, t.sort_no`
  );
  http.ok(ctx, {
    tasks: rows.map((r) => ({
      id: r.id,
      date: r.day_date,
      weekday: r.weekday || time.weekdayOf(r.day_date),
      theme: r.theme,
      name: r.task_name,
      desc: r.task_desc,
      how: r.task_how,
      isOffline: !!r.is_offline,
      offlinePoint: r.offline_point,
      doneCount: Number(r.doneCount),
    })),
  });
});

/** 编辑单项任务。老打卡记录里的主题/任务名是冗余快照，天然不受影响 */
router.put('/tasks/:id', async (ctx) => {
  const id = sql.int(ctx.params.id, 0, { min: 1 });
  const row = await db.one('SELECT * FROM daka_task WHERE id = ?', [id]);
  if (!row) throw http.notFound('任务不存在');

  const norm = normalizeTaskBody(ctx.request.body || {});
  if (norm.error) throw http.bad(norm.error);

  const dup = await db.one(
    'SELECT id FROM daka_task WHERE day_date = ? AND theme = ? AND id <> ?',
    [row.day_date, norm.value.theme, id]
  );
  if (dup) throw http.conflict(`这一天「${norm.value.theme}」主题已有任务（一天一个主题只有一项）`);

  await db.exec(
    `UPDATE daka_task
        SET theme = ?, task_name = ?, task_desc = ?, task_how = ?, is_offline = ?, offline_point = ?
      WHERE id = ?`,
    [norm.value.theme, norm.value.name, norm.value.desc, norm.value.how,
     norm.value.isOffline ? 1 : 0, norm.value.offlinePoint, id]
  );
  await log(ctx, 'UPDATE_TASK', `task:${id}`,
    `10月${Number(String(row.day_date).slice(8, 10))}日「${row.task_name}」已编辑为「${norm.value.name}」`);
  http.ok(ctx, { message: '已保存，参与者端立即生效' });
});

/** 恢复默认：把这一项还原成 tasks-data.js 里的原始内容（按当前 天+主题 反查） */
router.post('/tasks/:id/reset', async (ctx) => {
  const id = sql.int(ctx.params.id, 0, { min: 1 });
  const row = await db.one('SELECT * FROM daka_task WHERE id = ?', [id]);
  if (!row) throw http.notFound('任务不存在');

  const day = TASK_DEFAULTS.DAYS.find((d) => d.date === String(row.day_date));
  const def = day && day.tasks.find((t) => t.theme === row.theme);
  if (!def) throw http.notFound(`默认字典里找不到这一天「${row.theme}」主题的任务（主题可能被改过），请手动改回`);

  await db.exec(
    `UPDATE daka_task
        SET task_name = ?, task_desc = ?, task_how = ?, is_offline = ?, offline_point = ?
      WHERE id = ?`,
    [def.name, def.desc, def.how, def.offline ? 1 : 0, def.offline ? (day.offline || '') : '', id]
  );
  await log(ctx, 'RESET_TASK', `task:${id}`, `10月${Number(String(row.day_date).slice(8, 10))}日「${def.name}」已恢复默认内容`);
  http.ok(ctx, { message: '已恢复默认内容' });
});

// ------------------------------------------------------------------ 设置

router.get('/settings', async (ctx) => {
  const values = await settings.all(true);
  http.ok(ctx, {
    values,
    labels: settings.LABELS,
    defaults: settings.DEFAULTS,
  });
});

router.put('/settings', async (ctx) => {
  try {
    const body = ctx.request.body || {};
    const payload = body.values || body;
    const values = await settings.setMany(payload);
    await log(ctx, 'UPDATE_SETTINGS', 'config', `更新配置：${Object.keys(payload).join(', ')}`);
    http.ok(ctx, { values, message: '设置已保存，立即生效' });
  } catch (e) {
    if (e && e.status) {
      ctx.status = e.status;
      ctx.body = { ok: false, code: e.code, message: e.message };
    } else {
      ctx.status = 500;
      ctx.body = { ok: false, code: 'ERR', message: e.message || '保存失败' };
    }
  }
});

router.get('/oplog', async (ctx) => {
  const pageSize = sql.int(ctx.query.pageSize, 50, { min: 1, max: 200 });
  const rows = await db.q(
    `SELECT id, admin_name, action, target, detail, ip, created_at
       FROM daka_oplog ORDER BY id DESC LIMIT ${pageSize}`
  );
  http.ok(ctx, { list: rows });
});

module.exports = router;
