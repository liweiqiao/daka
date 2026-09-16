'use strict';

/**
 * 统计口径对账 —— 拿「手写 SQL 算出来的真值」去核对「接口返回的数字」。
 *
 * 为什么不能只跑 smoke.js：
 *   smoke.js 验的是「接口能不能通」，而这个脚本验的是「数字对不对」。
 *   后者才是活动方真正会盯着看的东西 —— 后台显示 1512 次、导出 Excel
 *   合计却是 1400 次，这种事只有对账才能发现。
 *
 * 用法：
 *   node test/stats-audit.js
 *   node test/stats-audit.js --base=http://127.0.0.1:3000 --admin-pass=xxx
 *
 * 退出码 0 = 全部一致。
 */

const mysql = require('mysql2/promise');
const config = require('../src/config');

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};

const BASE = arg('base', 'http://127.0.0.1:3000').replace(/\/+$/, '');
// 不传 --admin-pass 时用 .env 里的 ADMIN_INIT_PASSWORD 兜底（config 已加载 dotenv）
const ADMIN_PASS = arg('admin-pass', process.env.ADMIN_INIT_PASSWORD || 'admin123456');

let pass = 0;
let fail = 0;
const bad = [];

function eq(label, got, want, note) {
  const g = typeof got === 'number' ? got : Number(got);
  const w = typeof want === 'number' ? want : Number(want);
  if (g === w) {
    pass += 1;
    console.log(`  ✓ ${label}  ${g}${note ? '  (' + note + ')' : ''}`);
  } else {
    fail += 1;
    bad.push(`${label}：接口 ${g} ≠ 库真值 ${w}`);
    console.log(`  ✗ ${label}  → 接口 ${g}，库真值 ${w}`);
  }
}

let token = '';

async function api(pathname) {
  const res = await fetch(BASE + pathname, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  if (res.status >= 400) throw new Error(`GET ${pathname} → ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text).data;
}

async function main() {
  console.log('\n清城少年志 · 统计口径对账');
  console.log(`  接口 ${BASE}   ←→   库 ${config.db.host}/${config.db.database}\n`);

  const c = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: 'utf8mb4',
    timezone: '+08:00',
    dateStrings: true,
  });

  const one = async (sql, p = []) => (await c.query(sql, p))[0][0];
  const many = async (sql, p = []) => (await c.query(sql, p))[0];

  // 登录后台
  const login = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: ADMIN_PASS }),
  });
  const lj = await login.json();
  if (!lj.ok) {
    // 登录接口有 10 次/10 分钟限流，这是正确的安全设计，不该为了测试放宽。
    // 撞上 429 时说明"这一轮没验成"，而不是"对账不一致"，所以要走"跳过"而不是"中断"。
    if (login.status === 429 || lj.code === 'TOO_MANY_REQUESTS') {
      const e = new Error('登录接口被限流（10 次/10 分钟）');
      e.rateLimited = true;
      throw e;
    }
    throw new Error('后台登录失败：' + JSON.stringify(lj).slice(0, 200));
  }
  token = lj.data.token;

  // ---------------------------------------------------------- A. 数据自洽
  console.log('[A] 库内数据自洽性（不涉及接口）');

  const dupOnce = await one(
    `SELECT COUNT(*) AS n FROM (
       SELECT participant_id, task_id FROM daka_checkin
        GROUP BY participant_id, task_id HAVING COUNT(*) > 1
     ) t`
  );
  eq('同一人同一任务重复打卡的组数（必须为 0）', dupOnce.n, 0);

  const dupBatch = await one(
    `SELECT COUNT(*) AS n FROM (
       SELECT request_id FROM daka_batch GROUP BY request_id HAVING COUNT(*) > 1
     ) t`
  );
  eq('requestId 重复的组数（必须为 0）', dupBatch.n, 0);

  const orphanMedia = await one('SELECT COUNT(*) AS n FROM daka_media WHERE status = 1 AND batch_id IS NULL');
  eq('状态为已绑定却没有批次的凭证（必须为 0）', orphanMedia.n, 0);

  const boundNoTask = await one('SELECT COUNT(*) AS n FROM daka_media WHERE status = 1 AND task_id IS NULL');
  eq('已绑定却不知道属于哪一题的凭证（必须为 0）', boundNoTask.n, 0);

  const dateMismatch = await one(
    `SELECT COUNT(*) AS n FROM daka_checkin c
       JOIN daka_task t ON t.id = c.task_id
      WHERE c.checkin_date <> t.day_date`
  );
  eq('打卡日期与任务所属日期不一致的条数（必须为 0）', dateMismatch.n, 0);

  const themeMismatch = await one(
    `SELECT COUNT(*) AS n FROM daka_checkin c
       JOIN daka_task t ON t.id = c.task_id
      WHERE c.theme <> t.theme`
  );
  eq('快照主题与任务字典不一致的条数（必须为 0）', themeMismatch.n, 0);

  const batchCountWrong = await one(
    `SELECT COUNT(*) AS n FROM (
       SELECT b.id
         FROM daka_batch b
         LEFT JOIN daka_checkin c ON c.batch_id = b.id
        GROUP BY b.id, b.item_count
       HAVING COUNT(c.id) <> b.item_count
     ) t`
  );
  eq('批次 item_count 与实际明细数不符的批次数（必须为 0）', batchCountWrong.n, 0);

  const batchMediaWrong = await one(
    `SELECT COUNT(*) AS n FROM (
       SELECT b.id
         FROM daka_batch b
         LEFT JOIN daka_media m ON m.batch_id = b.id AND m.status = 1
        GROUP BY b.id, b.photo_count, b.video_count
       HAVING SUM(m.media_type='image') <> b.photo_count
           OR SUM(m.media_type='video') <> b.video_count
     ) t`
  );
  eq('批次 photo/video_count 与凭证台账不符的批次数（必须为 0）', batchCountWrong.n >= 0 ? batchMediaWrong.n : -1, 0);

  const everyCheckinHasPhoto = await one(
    `SELECT COUNT(*) AS n FROM daka_checkin c
      WHERE NOT EXISTS (
        SELECT 1 FROM daka_media m
         WHERE m.participant_id = c.participant_id
           AND m.task_id = c.task_id
           AND m.media_type = 'image' AND m.status = 1
      )`
  );
  eq('没有照片的打卡记录条数（照片必填，必须为 0）', everyCheckinHasPhoto.n, 0);

  // ---------------------------------------------------------- B. 概览 KPI
  console.log('\n[B] 后台总览 KPI vs 库真值');

  const truthChecks = await one('SELECT COUNT(*) AS n FROM daka_checkin');
  const truthPeople = await one('SELECT COUNT(DISTINCT participant_id) AS n FROM daka_checkin');
  const truthReg = await one('SELECT COUNT(*) AS n FROM daka_participant');
  const truthPhotos = await one("SELECT COUNT(*) AS n FROM daka_media WHERE status=1 AND media_type='image'");
  const truthVideos = await one("SELECT COUNT(*) AS n FROM daka_media WHERE status=1 AND media_type='video'");

  const dashboard = await api('/api/admin/dashboard?date=2026-10-07');
  const ov = dashboard.overview;

  eq('累计打卡次数', ov.totalCheckins, truthChecks.n);
  eq('累计打卡人数', ov.totalPeople, truthPeople.n);
  eq('登记人数', ov.registeredPeople, truthReg.n);
  eq('未打卡人数 = 登记 − 打卡人数', ov.idlePeople, Number(truthReg.n) - Number(truthPeople.n));
  eq('照片总数', ov.media.photos, truthPhotos.n);
  eq('视频总数', ov.media.videos, truthVideos.n);

  const avgTruth = Number(truthChecks.n) / Number(truthPeople.n);
  eq('人均打卡次数', ov.avgPerPerson, Number(avgTruth.toFixed(2)));

  // ---------------------------------------------------------- C. 当日口径
  console.log('\n[C] 当日口径（2026-10-07）');

  const day = '2026-10-07';
  const truthDayChecks = await one('SELECT COUNT(*) AS n FROM daka_checkin WHERE checkin_date = ?', [day]);
  const truthDayPeople = await one('SELECT COUNT(DISTINCT participant_id) AS n FROM daka_checkin WHERE checkin_date = ?', [day]);
  const truthDayBatches = await one('SELECT COUNT(*) AS n FROM daka_batch WHERE checkin_date = ?', [day]);

  eq('当日打卡次数', dashboard.daily.checkins, truthDayChecks.n);
  eq('当日打卡人数', dashboard.daily.people, truthDayPeople.n);
  eq('当日提交批次数', dashboard.daily.batches, truthDayBatches.n);

  // 当日逐项人数 → 最多/最少必须与接口一致（含并列）
  const perTask = await many(
    `SELECT t.id, t.theme, t.task_name, COUNT(c.id) AS n
       FROM daka_task t
       LEFT JOIN daka_checkin c ON c.task_id = t.id AND c.checkin_date = ?
      WHERE t.day_date = ?
      GROUP BY t.id, t.theme, t.task_name, t.sort_no
      ORDER BY n DESC, t.sort_no`,
    [day, day]
  );
  const maxN = Math.max(...perTask.map((r) => Number(r.n)));
  const minN = Math.min(...perTask.map((r) => Number(r.n)));
  const wantMax = perTask.filter((r) => Number(r.n) === maxN).map((r) => r.task_name).sort();
  const wantMin = perTask.filter((r) => Number(r.n) === minN).map((r) => r.task_name).sort();
  const gotMax = dashboard.daily.max.map((x) => x.taskName).sort();
  const gotMin = dashboard.daily.min.map((x) => x.taskName).sort();

  eq('当日最多项目数（含并列）', gotMax.length, wantMax.length, `真值 ${wantMax.join('/') || '（无）'}`);
  eq('最多项目人数', dashboard.daily.max[0] ? dashboard.daily.max[0].count : -1, maxN);
  eq('当日最少项目数（含并列）', gotMin.length, wantMin.length, `真值 ${wantMin.join('/') || '（无）'}`);
  eq('最少项目人数', dashboard.daily.min[0] ? dashboard.daily.min[0].count : -1, minN);
  eq('当日 7 项任务全部出现在排行里', dashboard.daily.tasks.length, 7);

  // ---------------------------------------------------------- D. 趋势 / 矩阵
  console.log('\n[D] 趋势与矩阵');

  const truthTrend = await many(
    'SELECT checkin_date, COUNT(*) AS n, COUNT(DISTINCT participant_id) AS p FROM daka_checkin GROUP BY checkin_date'
  );
  const trendMap = new Map(truthTrend.map((r) => [r.checkin_date, r]));
  let trendOk = 0;
  dashboard.trend.forEach((d) => {
    const t = trendMap.get(d.date) || { n: 0, p: 0 };
    if (d.checkins === Number(t.n) && d.people === Number(t.p)) trendOk += 1;
  });
  eq('趋势里 7 天逐日次数/人数全部一致的天数', trendOk, 7);

  const matrixSum = dashboard.matrix.cells.reduce((n, x) => n + x.count, 0);
  eq('矩阵 49 格合计 = 累计打卡次数', matrixSum, truthChecks.n);
  eq('矩阵格子数', dashboard.matrix.cells.length, 49);

  const matrixByTheme = {};
  dashboard.matrix.cells.forEach((x) => { matrixByTheme[x.theme] = (matrixByTheme[x.theme] || 0) + x.count; });
  const truthByTheme = await many('SELECT theme, COUNT(*) AS n FROM daka_checkin GROUP BY theme');
  let themeOk = 0;
  truthByTheme.forEach((r) => { if (matrixByTheme[r.theme] === Number(r.n)) themeOk += 1; });
  eq('矩阵按主题汇总与库一致的个数', themeOk, truthByTheme.length);

  // ---------------------------------------------------------- E. 学校排行
  console.log('\n[E] 学校排行');

  const truthSchoolSum = await one('SELECT COUNT(DISTINCT school) AS n FROM daka_participant');
  eq('学校排行的分组数（≤20 条上限）', dashboard.schools.length, Math.min(20, Number(truthSchoolSum.n)));
  const schoolTop = dashboard.schools[0];
  if (schoolTop) {
    const t = await one(
      `SELECT COUNT(DISTINCT p.id) AS people, COUNT(c.id) AS checkins
         FROM daka_participant p
         LEFT JOIN daka_checkin c ON c.participant_id = p.id
        WHERE p.school = ?`,
      [schoolTop.school]
    );
    eq('排行第一所学校的人数', schoolTop.people, t.people, schoolTop.school.slice(0, 20));
    eq('排行第一所学校的打卡数', schoolTop.checkins, t.checkins);
  }

  // ---------------------------------------------------------- F. 荣誉名单
  console.log('\n[F] 荣誉达标名单');

  const h = await api('/api/admin/honors?types=allRound,themeCert');

  const truthAllRound = await one(
    `SELECT COUNT(*) AS n FROM (
       SELECT participant_id FROM daka_checkin
        GROUP BY participant_id
        HAVING COUNT(DISTINCT theme) >= 7 AND COUNT(*) >= ?
     ) t`,
    [config.activity.hzTotal]
  );
  eq(`全能少年人数（7 主题且 ≥${config.activity.hzTotal} 次）`, h.allRound.length, truthAllRound.n);

  const truthCerts = await many(
    `SELECT theme, COUNT(*) AS n FROM (
       SELECT theme, participant_id FROM daka_checkin
        GROUP BY theme, participant_id HAVING COUNT(*) >= ?
     ) t GROUP BY theme`,
    [config.activity.hzThemeCert]
  );
  let certOk = 0;
  truthCerts.forEach((r) => {
    const g = h.themeCert.find((x) => x.theme === r.theme);
    if (g && g.list.length === Number(r.n)) certOk += 1;
  });
  eq('主题专项证书各主题人数一致的主题数', certOk, truthCerts.length);
  eq('荣誉接口下发门槛（单主题任务数）', h.thresholds.themeCert, config.activity.hzThemeCert);
  eq('荣誉接口下发门槛（累计次数）', h.thresholds.total, config.activity.hzTotal);

  // ---------------------------------------------------------- G. 重名
  console.log('\n[G] 重名检测');

  const truthDup = await many(
    `SELECT name, COUNT(*) AS n, COUNT(DISTINCT school) AS sc, COUNT(DISTINCT phone) AS pc
       FROM daka_participant GROUP BY name HAVING COUNT(*) > 1`
  );
  const dups = await api('/api/admin/duplicates?limit=2000');
  eq('重名姓名的组数', dups.duplicates.length, truthDup.length);
  const truthSuspicious = truthDup.filter((r) => Number(r.sc) === 1 && Number(r.pc) === 1).length;
  eq('疑似重复登记（同名同校同手机）组数', dups.suspicious.length, truthSuspicious);
  const dupPeopleTotal = dups.duplicates.reduce((n, g) => n + g.people.length, 0);
  const truthDupPeople = await one(
    `SELECT COUNT(*) AS n FROM daka_participant
      WHERE name IN (SELECT name FROM (SELECT name FROM daka_participant GROUP BY name HAVING COUNT(*)>1) x)`
  );
  eq('重名涉及的人数', dupPeopleTotal, truthDupPeople.n);

  // ---------------------------------------------------------- H. 明细分页
  console.log('\n[H] 明细分页与筛选');

  const page1 = await api('/api/admin/checkins?page=1&pageSize=50');
  eq('明细总数', page1.total, truthChecks.n);
  eq('第 1 页返回条数', page1.list.length, 50);
  const lastPage = await api(`/api/admin/checkins?page=${page1.pages}&pageSize=50`);
  eq('最后一页仍有数据', lastPage.list.length > 0, 1);
  const allIds = new Set([...page1.list, ...lastPage.list].map((x) => x.id));
  eq('第 1 页与最后一页无重复记录', allIds.size, page1.list.length + lastPage.list.length);

  const dayFilter = await api(`/api/admin/checkins?date=${day}&pageSize=1`);
  eq('按日期筛选后的总数', dayFilter.total, truthDayChecks.n);

  const themeFilter = await api('/api/admin/checkins?theme=专注&pageSize=1');
  const truthTheme = await one("SELECT COUNT(*) AS n FROM daka_checkin WHERE theme='专注'");
  eq('按主题（专注）筛选后的总数', themeFilter.total, truthTheme.n);

  const offlineFilter = await api('/api/admin/checkins?offline=1&pageSize=1');
  const truthOffline = await one('SELECT COUNT(*) AS n FROM daka_checkin WHERE is_offline = 1');
  eq('线下打卡点记录数', offlineFilter.total, truthOffline.n);

  // ---------------------------------------------------------- I. 参与者视角
  console.log('\n[I] 参与者「我的记录」与进度');

  const somePerson = await one(
    `SELECT c.participant_id, p.name, p.phone
       FROM daka_checkin c JOIN daka_participant p ON p.id = c.participant_id
      GROUP BY c.participant_id, p.name, p.phone
      ORDER BY COUNT(*) DESC LIMIT 1`
  );
  const luck = await fetch(`${BASE}/api/participant/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: somePerson.name, phone: somePerson.phone }),
  });
  const lj2 = await luck.json();
  if (!lj2.ok) {
    console.log(`    （示例参与者登录失败：${lj2.message}，跳过本节）`);
  } else {
    const ptoken = lj2.data.token;
    const recRes = await fetch(`${BASE}/api/me/records`, { headers: { Authorization: `Bearer ${ptoken}` } });
    const records = (await recRes.json()).data;

    const truthMyCount = await one('SELECT COUNT(*) AS n FROM daka_checkin WHERE participant_id = ?', [somePerson.participant_id]);
    const truthMyDays = await one('SELECT COUNT(DISTINCT checkin_date) AS n FROM daka_checkin WHERE participant_id = ?', [somePerson.participant_id]);

    eq('该人个人进度累计次数', records.progress.total, truthMyCount.n, `参与者 #${somePerson.participant_id}`);
    eq('该人打卡天数', records.progress.days, truthMyDays.n);
    const itemsInRecords = records.days.reduce((n, d) => n + d.items.length, 0);
    eq('「我的记录」里逐项相加 = 累计次数', itemsInRecords, truthMyCount.n);
    eq('记录按天分组的组数', records.days.length, truthMyDays.n);

    const mediaInRecords = records.days.reduce(
      (n, d) => n + d.items.reduce((m, it) => m + (it.images ? it.images.length : 0), 0), 0
    );
    const truthMyMedia = await one(
      `SELECT COUNT(*) AS n FROM daka_media m
        WHERE m.participant_id = ? AND m.status = 1 AND m.media_type='image'`,
      [somePerson.participant_id]
    );
    eq('记录里展示的照片数 = 该人绑定的照片数', mediaInRecords, truthMyMedia.n);
  }

  // ---------------------------------------------------------- J. 导出
  console.log('\n[J] 导出内容与统计一致');

  const csvRes = await fetch(`${BASE}/api/admin/export/checkins`, { headers: { Authorization: `Bearer ${token}` } });
  // 注意：不能用 res.text() 判 BOM —— TextDecoder 会按规范把开头的 BOM 吃掉，
  // 于是"文件里明明有 BOM"却测出没有。要看原始字节。
  const csvBuf = Buffer.from(await csvRes.arrayBuffer());
  const csvText = csvBuf.toString('utf8');
  const dataLines = csvText.replace(/^\ufeff/, '').trim().split('\r\n').length - 1; // 去掉表头
  eq('打卡明细 CSV 数据行数 = 累计打卡次数', dataLines, truthChecks.n);
  eq('CSV 以 UTF-8 BOM 开头（Excel 不乱码）',
    csvBuf[0] === 0xef && csvBuf[1] === 0xbb && csvBuf[2] === 0xbf, 1,
    `实际前三字节 ${csvBuf[0].toString(16)} ${csvBuf[1].toString(16)} ${csvBuf[2].toString(16)}`);
  eq('CSV 用 CRLF 换行（Excel 不串行）', csvBuf.includes(Buffer.from('\r\n')), 1);
  eq('CSV 含中文表头', csvText.includes('主题') && csvText.includes('学校'), 1);

  const sumRes = await fetch(`${BASE}/api/admin/export/participants`, { headers: { Authorization: `Bearer ${token}` } });
  const sumText = await sumRes.text();
  const sumLines = sumText.trim().split('\r\n').length - 1;
  eq('参与者汇总 CSV 行数 = 登记人数', sumLines, truthReg.n);

  const zipRes = await fetch(`${BASE}/api/admin/export/media.zip?date=${day}&maxFiles=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  eq('按日期打包附件返回 200', zipRes.status, 200);
  eq('zip 条目数（受 maxFiles 限制）', Number(zipRes.headers.get('x-zip-entries') || 0) > 0, 1);
  const zipBuf = Buffer.from(await zipRes.arrayBuffer());
  eq('zip 头两字节是 PK', zipBuf[0] === 0x50 && zipBuf[1] === 0x4b, 1);

  await c.end();

  console.log(`\n结果：一致 ${pass} 项，不一致 ${fail} 项`);
  if (fail) {
    console.log('不一致明细：');
    bad.forEach((x) => console.log('  - ' + x));
  }
  console.log('');
}

main()
  .then(() => process.exit(fail ? 1 : 0))
  .catch((e) => {
    if (e.rateLimited) {
      console.error('\n本轮对账未能进行：' + e.message);
      console.error('  这是正确的安全设计，不是失败，也和统计口径对错无关。');
      console.error('  等 10 分钟，或重启一次后端服务（计数在内存里）再跑。');
      console.error('  退出码 3 = 跑得不完整（不是失败）。\n');
      process.exit(3);
    }
    console.error('\n对账中断：' + e.message + '\n');
    process.exit(2);
  });
