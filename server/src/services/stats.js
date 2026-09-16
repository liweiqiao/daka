'use strict';

/**
 * 统计服务 —— 活动方要看的每一个数字都出自这里。
 *
 * 统一口径（重要，别处不要再自己算）：
 *   累计打卡次数 = daka_checkin 的行数（每完成 1 项算 1 次）
 *   累计打卡人数 = 有至少 1 条 daka_checkin 的参与者数（登记了但没打卡的不算）
 *   当日打卡最多/最少项目 = 当天 7 项任务里，参与人数最多/最少的那一项
 *                           （并列时全部列出，不随便挑一个）
 *
 * 为什么不做缓存表：1000 人 × 7 天最多 4.9 万行明细，带索引的聚合查询在
 * 毫秒级；而维护缓存表一旦出错就是"后台数字和导出文件对不上"，
 * 对活动方来说比慢几毫秒严重得多。
 */

const db = require('../db');
const time = require('../time');
const config = require('../config');
const sql = require('../sql');

const THEMES = ['专注', '乐观', '希望', '自信', '感恩', '坚韧', '活力'];

// ---------------------------------------------------------------- 概览 KPI

/**
 * 后台首屏 KPI。
 * @param {string} [date] 指定日期，默认今天（北京时间）
 */
async function overview(date) {
  const today = date || time.today();

  const [
    totalCheckin, totalPeople, totalParticipants,
    todayCheckin, todayPeople,
    todayBatches, mediaRow, offlineRow,
  ] = await Promise.all([
    db.one('SELECT COUNT(*) AS n FROM daka_checkin'),
    db.one('SELECT COUNT(DISTINCT participant_id) AS n FROM daka_checkin'),
    db.one('SELECT COUNT(*) AS n FROM daka_participant'),
    db.one('SELECT COUNT(*) AS n FROM daka_checkin WHERE checkin_date = ?', [today]),
    db.one('SELECT COUNT(DISTINCT participant_id) AS n FROM daka_checkin WHERE checkin_date = ?', [today]),
    db.one('SELECT COUNT(*) AS n FROM daka_batch WHERE checkin_date = ?', [today]),
    db.one(
      `SELECT
         SUM(media_type = 'image') AS photos,
         SUM(media_type = 'video') AS videos,
         COALESCE(SUM(file_size), 0) AS bytes
       FROM daka_media WHERE status = 1`
    ),
    db.one('SELECT COUNT(*) AS n FROM daka_checkin WHERE is_offline = 1'),
  ]);

  const total = Number(totalCheckin.n);
  const people = Number(totalPeople.n);
  const reg = Number(totalParticipants.n);

  const photoCount = Number(mediaRow.photos || 0);
  const videoCount = Number(mediaRow.videos || 0);

  return {
    date: today,
    totalCheckins: total,
    totalPeople: people,
    registeredPeople: reg,
    // 登记了但一次都没打卡的人：活动方要拿来催
    idlePeople: Math.max(0, reg - people),
    avgPerPerson: people ? Number((total / people).toFixed(2)) : 0,
    today: {
      checkins: Number(todayCheckin.n),
      people: Number(todayPeople.n),
      batches: Number(todayBatches.n),
    },
    media: {
      photos: photoCount,
      videos: videoCount,
      totalBytes: Number(mediaRow.bytes || 0),
      totalMB: Number((Number(mediaRow.bytes || 0) / 1048576).toFixed(1)),
    },
    offlineCheckins: Number(offlineRow.n),
    pendingMedia: await db.one('SELECT COUNT(*) AS n FROM daka_media WHERE status = 0').then((r) => Number(r.n)),
    activity: {
      startDate: config.activity.startDate,
      endDate: config.activity.endDate,
      dayIndex: time.diffDays(config.activity.startDate, today) + 1,
      totalDays: time.activityDates().length,
    },
  };
}

// ------------------------------------------------------- 当日最多 / 最少项目

/**
 * 某天 7 项任务的打卡情况排名。
 * 关键点：即使某项 0 人打卡也要出现在结果里（LEFT JOIN 保证），
 * 否则"打卡最少的项目"会变成"没人做所以看不见"。
 */
async function dailyTaskRank(date) {
  const rows = await db.q(
    `SELECT
        t.id           AS task_id,
        t.theme        AS theme,
        t.task_name    AS task_name,
        t.is_offline   AS is_offline,
        t.offline_point AS offline_point,
        t.sort_no      AS sort_no,
        COUNT(c.id)                  AS count,
        COUNT(DISTINCT c.participant_id) AS people
       FROM daka_task t
       LEFT JOIN daka_checkin c ON c.task_id = t.id AND c.checkin_date = ?
      WHERE t.day_date = ?
      GROUP BY t.id, t.theme, t.task_name, t.is_offline, t.offline_point, t.sort_no
      ORDER BY count DESC, t.sort_no ASC`,
    [date, date]
  );

  const list = rows.map((r) => ({
    taskId: r.task_id,
    theme: r.theme,
    taskName: r.task_name,
    isOffline: !!r.is_offline,
    offlinePoint: r.offline_point || '',
    count: Number(r.count),
    people: Number(r.people),
  }));

  if (!list.length) return { date, list: [], max: [], min: [], total: 0 };

  const maxN = Math.max(...list.map((x) => x.count));
  const minN = Math.min(...list.map((x) => x.count));
  return {
    date,
    list,
    total: list.reduce((n, x) => n + x.count, 0),
    maxCount: maxN,
    minCount: minN,
    max: list.filter((x) => x.count === maxN),
    min: list.filter((x) => x.count === minN),
  };
}

/** 后台首屏一张卡：当日概况 + 最多/最少 */
async function dailySummary(date) {
  const day = date || time.today();
  const [rank, batchRow, peopleRow, themeRows] = await Promise.all([
    dailyTaskRank(day),
    db.one('SELECT COUNT(*) AS n FROM daka_batch WHERE checkin_date = ?', [day]),
    db.one('SELECT COUNT(DISTINCT participant_id) AS n FROM daka_checkin WHERE checkin_date = ?', [day]),
    db.q(
      `SELECT theme, COUNT(*) AS n, COUNT(DISTINCT participant_id) AS people
         FROM daka_checkin WHERE checkin_date = ? GROUP BY theme`,
      [day]
    ),
  ]);

  const themeMap = {};
  themeRows.forEach((r) => { themeMap[r.theme] = { count: Number(r.n), people: Number(r.people) }; });

  return {
    date: day,
    weekday: time.weekdayOf(day),
    checkins: rank.total,
    batches: Number(batchRow.n),
    people: Number(peopleRow.n),
    avgItemsPerBatch: Number(batchRow.n) ? Number((rank.total / Number(batchRow.n)).toFixed(2)) : 0,
    max: rank.max,
    min: rank.min,
    tasks: rank.list,
    themes: THEMES.map((t) => ({
      theme: t,
      count: themeMap[t] ? themeMap[t].count : 0,
      people: themeMap[t] ? themeMap[t].people : 0,
    })),
  };
}

// ------------------------------------------------------------------ 趋势

/** 活动期内每日趋势（没打卡的日期也要有点，折线才连续） */
async function trend() {
  const rows = await db.q(
    `SELECT checkin_date,
            COUNT(*) AS checkins,
            COUNT(DISTINCT participant_id) AS people,
            COUNT(DISTINCT batch_id) AS batches
       FROM daka_checkin
      GROUP BY checkin_date
      ORDER BY checkin_date`
  );
  const map = new Map(rows.map((r) => [r.checkin_date, r]));
  const today = time.today();

  return time.activityDates().map((d) => {
    const r = map.get(d);
    return {
      date: d,
      weekday: time.weekdayOf(d),
      checkins: r ? Number(r.checkins) : 0,
      people: r ? Number(r.people) : 0,
      batches: r ? Number(r.batches) : 0,
      isToday: d === today,
      isFuture: time.diffDays(today, d) > 0,
    };
  });
}

/** 日期 × 主题 矩阵（热力图 / 交叉表用） */
async function matrix() {
  const rows = await db.q(
    `SELECT checkin_date, theme, COUNT(*) AS n, COUNT(DISTINCT participant_id) AS people
       FROM daka_checkin GROUP BY checkin_date, theme`
  );
  const key = (d, t) => `${d}|${t}`;
  const map = new Map(rows.map((r) => [key(r.checkin_date, r.theme), r]));

  const dates = time.activityDates();
  const cells = [];
  dates.forEach((d) => {
    THEMES.forEach((t) => {
      const r = map.get(key(d, t));
      cells.push({
        date: d, theme: t,
        count: r ? Number(r.n) : 0,
        people: r ? Number(r.people) : 0,
      });
    });
  });

  const byTheme = THEMES.map((t) => ({
    theme: t,
    count: cells.filter((c) => c.theme === t).reduce((n, c) => n + c.count, 0),
  })).sort((a, b) => b.count - a.count);

  const byDate = dates.map((d) => ({
    date: d,
    weekday: time.weekdayOf(d),
    count: cells.filter((c) => c.date === d).reduce((n, c) => n + c.count, 0),
  }));

  return {
    themes: THEMES,
    dates,
    cells,
    byTheme,
    byDate,
    maxCell: cells.reduce((m, c) => Math.max(m, c.count), 0),
  };
}

// ------------------------------------------------------------- 学校 / 荣誉

async function schoolRank(limit = 30) {
  const lim = sql.int(limit, 30, { min: 1, max: 200 });
  const rows = await db.q(
    `SELECT p.school,
            COUNT(DISTINCT p.id) AS people,
            COUNT(c.id) AS checkins,
            COUNT(DISTINCT c.checkin_date) AS daySum
       FROM daka_participant p
       LEFT JOIN daka_checkin c ON c.participant_id = p.id
      GROUP BY p.school
      ORDER BY checkins DESC, people DESC
      LIMIT ${lim}`
  );
  return rows.map((r) => ({
    school: r.school,
    people: Number(r.people),
    checkins: Number(r.checkins),
    avgPerPerson: Number(r.people) ? Number((Number(r.checkins) / Number(r.people)).toFixed(2)) : 0,
  }));
}

/**
 * 荣誉达标名单（2026 标准，8 条）。
 *  - themeCert 主题专项证书：某主题完成任务数满 hzThemeCert（默认 7，即该主题 7 个任务全做完），
 *    按主题各发一张专项证书（专注少年 / 乐观少年 / … / 活力少年）。
 *  - allRound 全能少年：7 个主题均有任务完成，且累计次数满 hzTotal（默认 20，含 20）。
 * 两个荣誉一次算完，避免两次全表扫描；全部基于明细现算 ——
 * 改荣誉门槛只需要改配置，历史数据自动跟着变。
 */
async function honors({ types = ['allRound', 'themeCert'], keyword = '', limit = 2000 } = {}) {
  const want = new Set(types);
  const lim = sql.int(limit, 2000, { min: 1, max: 5000 });
  const result = { thresholds: {
    themeCert: config.activity.hzThemeCert,
    total: config.activity.hzTotal,
  }, allRound: [], themeCert: [] };

  const nameFilter = keyword ? ' AND (p.name LIKE ? OR p.school LIKE ?)' : '';
  const kw = keyword ? [`%${keyword}%`, `%${keyword}%`] : [];

  if (want.has('allRound')) {
    const rows = await db.q(
      `SELECT p.id, p.name, p.school, p.phone,
              COUNT(c.id) AS total,
              COUNT(DISTINCT c.theme) AS themes
         FROM daka_participant p
         JOIN daka_checkin c ON c.participant_id = p.id
        WHERE 1=1 ${nameFilter}
        GROUP BY p.id, p.name, p.school, p.phone
       HAVING themes >= 7 AND total >= ?
        ORDER BY total DESC
        LIMIT ${lim}`,
      [...kw, config.activity.hzTotal]
    );
    result.allRound = rows.map(rowToPerson);
  }

  if (want.has('themeCert')) {
    const rows = await db.q(
      `SELECT c.theme, p.id, p.name, p.school, p.phone, COUNT(*) AS n
         FROM daka_checkin c
         JOIN daka_participant p ON p.id = c.participant_id
        WHERE 1=1 ${nameFilter}
        GROUP BY c.theme, p.id, p.name, p.school, p.phone
       HAVING n >= ?
        ORDER BY c.theme, n DESC`,
      [...kw, config.activity.hzThemeCert]
    );
    const byTheme = new Map();
    rows.forEach((r) => {
      if (!byTheme.has(r.theme)) byTheme.set(r.theme, []);
      byTheme.get(r.theme).push({ ...rowToPerson(r), themeCount: Number(r.n) });
    });
    result.themeCert = THEMES.filter((t) => byTheme.has(t))
      .map((t) => ({ theme: t, cert: `${t}少年`, list: byTheme.get(t).slice(0, lim) }));
  }

  return result;
}

function rowToPerson(r) {
  return {
    id: r.id,
    name: r.name,
    school: r.school,
    phone: maskPhone(r.phone),
    phoneRaw: r.phone,
    total: Number(r.total || 0),
    themes: Number(r.themes || 0),
  };
}

/** 后台列表默认打码，导出时才给全量 —— 后台截图外传不至于泄露家长手机号 */
function maskPhone(p) {
  const s = String(p || '');
  return s.length === 11 ? `${s.slice(0, 3)}****${s.slice(7)}` : s;
}

// ------------------------------------------------------------------ 重名

/**
 * 重名检测。
 * 姓名在系统里不是唯一标识，唯一标识是 id，所以重名本身不构成问题；
 * 这份列表的用途是：活动方在后台看"张三"时得知道看的是哪一个，
 * 以及证书发放时别把两个张三搞混。
 */
async function duplicates(limit = 500) {
  const lim = sql.int(limit, 500, { min: 1, max: 2000 });
  const rows = await db.q(
    `SELECT name,
            COUNT(*) AS n,
            COUNT(DISTINCT school) AS schoolCount,
            COUNT(DISTINCT phone) AS phoneCount
       FROM daka_participant
      GROUP BY name
     HAVING n > 1
      ORDER BY n DESC, name
      LIMIT ${lim}`
  );
  if (!rows.length) return [];

  const names = rows.map((r) => r.name);
  const people = await db.q(
    `SELECT p.id, p.name, p.school, p.phone, p.created_at,
            (SELECT COUNT(*) FROM daka_checkin c WHERE c.participant_id = p.id) AS total
       FROM daka_participant p
      WHERE p.name IN (${names.map(() => '?').join(',')})
      ORDER BY p.name, p.id`,
    names
  );
  const byName = new Map();
  people.forEach((p) => {
    if (!byName.has(p.name)) byName.set(p.name, []);
    byName.get(p.name).push({
      id: p.id, name: p.name, school: p.school,
      phone: maskPhone(p.phone), phoneRaw: p.phone,
      total: Number(p.total), createdAt: p.created_at,
    });
  });

  return rows.map((r) => ({
    name: r.name,
    count: Number(r.n),
    schoolCount: Number(r.schoolCount),
    phoneCount: Number(r.phoneCount),
    // 同名同校同手机 = 大概率是同一个人重复登记，值得人工合并
    suspicious: Number(r.schoolCount) === 1 && Number(r.phoneCount) === 1,
    people: byName.get(r.name) || [],
  }));
}

// --------------------------------------------------------- 姓名脱敏

/**
 * 公开页面上的姓名一律脱敏：「张*三」。
 * 后台明细给全名，公开场合（照片墙等）只给这个拼音。
 */
function maskName(n) {
  const s = String(n || '');
  if (s.length <= 2) return s.slice(0, 1) + '*';
  return s.slice(0, 1) + '*'.repeat(s.length - 2) + s.slice(-1);
}

// --------------------------------------------------------- 参与者活跃度

/** 打卡天数分布：帮助判断活动粘性（打满 7 天的人有多少） */
async function dayDistribution() {
  const rows = await db.q(
    `SELECT days, COUNT(*) AS people FROM (
        SELECT participant_id, COUNT(DISTINCT checkin_date) AS days
          FROM daka_checkin GROUP BY participant_id
     ) t GROUP BY days ORDER BY days`
  );
  const dist = rows.map((r) => ({ days: Number(r.days), people: Number(r.people) }));
  return {
    dist,
    participants: dist.reduce((n, d) => n + d.people, 0),
  };
}

/** 主题覆盖分布：完成 0-7 个主题的人各有多少 */
async function themeCoverage() {
  const rows = await db.q(
    `SELECT themes, COUNT(*) AS people FROM (
        SELECT participant_id, COUNT(DISTINCT theme) AS themes
          FROM daka_checkin GROUP BY participant_id
     ) t GROUP BY themes ORDER BY themes`
  );
  const map = new Map(rows.map((r) => [Number(r.themes), Number(r.people)]));
  return Array.from({ length: 8 }, (_, i) => ({ themes: i, people: map.get(i) || 0 }));
}

// --------------------------------------------------------- 提交时段分布

/**
 * 提交时段分布 —— 家长习惯在几点打卡。
 *
 * 口径（重要）：数的是 daka_batch 的**提交批次**，不是打卡次数。
 * 一次提交就是家长的一次真实操作动作，用它衡量"几点有人"最准；
 * 用打卡次数会被"一次提交勾了很多项"放大，峰值会失真。
 *
 * 时区：daka_batch.created_at 由连接层以 +08:00 写入（见 db.js 的 timezone），
 * 所以 HOUR() 拿到的就是北京小时，不用再换算。
 *
 * 用途：活动方据此定"当天几点发提醒" —— 推早了人还没空，推晚了当天就过了。
 */
async function hourlyDistribution() {
  const rows = await db.q(
    `SELECT HOUR(created_at) AS h, COUNT(*) AS n
       FROM daka_batch
      GROUP BY HOUR(created_at)`
  );
  const map = new Map(rows.map((r) => [Number(r.h), Number(r.n)]));

  // 0-23 点补齐，缺的记 0 —— 前端折线不能断，断了就看不出"空档时段"
  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: `${String(h).padStart(2, '0')}:00`,
    batches: map.get(h) || 0,
  }));

  const peak = hours.reduce((m, x) => (x.batches > m.batches ? x : m), hours[0]);
  const total = hours.reduce((n, x) => n + x.batches, 0);
  return {
    hours,
    total,
    peakHour: total ? peak.hour : null,
    peakBatches: total ? peak.batches : 0,
  };
}

// --------------------------------------------------------------- 参与漏斗

/**
 * 参与漏斗：登记 → 打过卡 → 坚持 3 天 → 满勤 7 天。
 *
 * 每一层都是**人数**（去重），不是次数 —— 漏斗图横轴必须同量纲，
 * 混进次数会让第二层比第一层还高，图就废了。
 *
 * 满勤的 7 天取自活动实际天数（activityDates().length），
 * 不写死 7：万一活动延长，这里的口径自动跟着变。
 */
async function funnel() {
  const fullDays = time.activityDates().length;
  const [reg, any, d3, full] = await Promise.all([
    db.one('SELECT COUNT(*) AS n FROM daka_participant'),
    db.one('SELECT COUNT(DISTINCT participant_id) AS n FROM daka_checkin'),
    db.one(
      `SELECT COUNT(*) AS n FROM (
          SELECT participant_id FROM daka_checkin
           GROUP BY participant_id HAVING COUNT(DISTINCT checkin_date) >= 3
       ) t`
    ),
    db.one(
      `SELECT COUNT(*) AS n FROM (
          SELECT participant_id FROM daka_checkin
           GROUP BY participant_id HAVING COUNT(DISTINCT checkin_date) >= ?
       ) t`,
      [fullDays]
    ),
  ]);

  const registered = Number(reg.n);
  const stages = [
    { key: 'registered', name: '已登记', people: registered },
    { key: 'checkedIn', name: '打过卡', people: Number(any.n) },
    { key: 'd3', name: `坚持 ${Math.min(3, fullDays)} 天`, people: Number(d3.n) },
    { key: 'full', name: `满勤 ${fullDays} 天`, people: Number(full ? full.n : 0) },
  ];

  // 逐层留存率：漏斗的洞在哪一层，一眼能看出来
  return {
    fullDays,
    stages: stages.map((s, i) => ({
      ...s,
      rateFromTop: registered ? Number((s.people / registered * 100).toFixed(1)) : 0,
      rateFromPrev: i === 0
        ? 100
        : (stages[i - 1].people ? Number((s.people / stages[i - 1].people * 100).toFixed(1)) : 0),
    })),
  };
}

// --------------------------------------------------------------- 荣誉汇总

/**
 * 两类荣誉的达标人数汇总（只出数字，名单走 honors()）。
 *
 * 门槛与 honors() 完全一致，都读 config.activity.*，
 * 改门槛只需改配置，这里和名单页自动跟着变。
 *
 * 「主题专项证书」数的是 (主题, 人) 配对而不是人：同一人可以在多个主题各拿一张专项证书，
 * 所以它的总数可以大于参与人数 —— 这是设计如此，不是算错。
 */
async function honorSummary() {
  const { hzThemeCert, hzTotal } = config.activity;
  const [reg, any, allRound, cert] = await Promise.all([
    db.one('SELECT COUNT(*) AS n FROM daka_participant'),
    db.one('SELECT COUNT(DISTINCT participant_id) AS n FROM daka_checkin'),
    db.one(
      `SELECT COUNT(*) AS n FROM (
          SELECT participant_id FROM daka_checkin
           GROUP BY participant_id
           HAVING COUNT(DISTINCT theme) >= 7 AND COUNT(*) >= ?
       ) t`,
      [hzTotal]
    ),
    db.one(
      `SELECT COUNT(*) AS n FROM (
          SELECT participant_id, theme FROM daka_checkin
           GROUP BY participant_id, theme HAVING COUNT(*) >= ?
       ) t`,
      [hzThemeCert]
    ),
  ]);

  const registered = Number(reg.n);
  const checkedIn = Number(any.n);
  return {
    thresholds: { themeCert: hzThemeCert, total: hzTotal },
    registered,
    checkedIn,
    honors: [
      {
        key: 'allRound', name: '全能少年',
        rule: `7 个主题均有完成，且累计满 ${hzTotal} 次`,
        count: Number(allRound.n), unit: '人',
      },
      {
        key: 'themeCert', name: '主题专项证书',
        rule: `单个主题完成满 ${hzThemeCert} 个任务`,
        count: Number(cert.n), unit: '张（同一人可多张）',
      },
    ],
    // 一个都没达标的人数，活动方用来看"参与是否过于浅"
    loners: Math.max(0, checkedIn - Number(cert.n)),
  };
}

module.exports = {
  THEMES,
  overview,
  dailyTaskRank,
  dailySummary,
  trend,
  matrix,
  schoolRank,
  honors,
  duplicates,
  dayDistribution,
  themeCoverage,
  hourlyDistribution,
  funnel,
  honorSummary,
  maskPhone,
  maskName,
  rowToPerson,
};
