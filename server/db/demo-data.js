'use strict';

/**
 * 造演示数据，用来在活动开始前验收统计口径。
 *
 * 为什么需要它：这套统计有十几个口径（累计次数/人数、当日最多最少、矩阵、
 * 荣誉达标），没有数据就验证不了对不对。等活动真开始再发现问题就来不及了。
 *
 * 用法：
 *   node db/demo-data.js                    默认 60 人，7 天都有数据
 *   node db/demo-data.js --people=200       造 200 人
 *   node db/demo-data.js --clear            只清演示数据
 *
 * 清理口径：所有手机号以 199 开头的参与者都视为演示数据（真实用户不会用这个段）。
 * 连带清掉他们的打卡记录与凭证台账，并删掉写进 uploads 的占位图片。
 *
 * ⚠ 活动正式开始前务必执行 `--clear`，别把演示数据混进真实统计。
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const config = require('../src/config');
const { DAYS, THEMES } = require('./tasks-data');

/** 演示数据统一用 199 号段，方便一键清理 */
const DEMO_PREFIX = '199';

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return def;
  const v = hit.split('=')[1];
  return v === '' ? true : v;
};
const flagOn = (name) => process.argv.includes(`--${name}`);

// ---------------------------------------------------------------- 名字池

const SURNAMES = '李王张刘陈杨黄赵吴周徐孙马朱胡林郭何高罗郑梁谢宋唐许韩冯邓曹彭曾萧田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤'.split('');

const GIVEN_1 = '子小梓宇欣雨晨思嘉佳梦怡静诗雅乐一雨语志明浩hyh'.replace(/[a-z]/g, '').split('');
const GIVEN_2 = '涵轩豪悦妍宸哲萱然诺曦辰琪杰宁菲彤皓苒晴宇菲'.split('');

/** 造出一批名字，其中故意留几个重名，用来验证重名检测 */
function makeNames(count) {
  const out = [];
  const seen = new Map();
  for (let i = 0; i < count; i += 1) {
    let name;
    if (i > 0 && i % 17 === 0 && out.length) {
      // 每 17 个人里安排一个和前面重名的
      name = out[Math.floor(Math.random() * out.length)];
    } else {
      const s = SURNAMES[Math.floor(Math.random() * SURNAMES.length)];
      const g1 = GIVEN_1[Math.floor(Math.random() * GIVEN_1.length)];
      const g2 = GIVEN_2[Math.floor(Math.random() * GIVEN_2.length)];
      name = s + g1 + g2;
    }
    seen.set(name, (seen.get(name) || 0) + 1);
    out.push(name);
  }
  return out;
}

const SCHOOLS = [
  '清城区第一小学', '清城区实验小学', '清城区凤翔小学', '清城区新北江小学',
  '清城区源潭镇中心小学', '清城区石角镇中心小学', '清远市第一中学',
  '清城区飞来湖中学', '清城区松岗中学', '清城区东城街中心小学',
].map((s) => `${s} ${['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二'][Math.floor(Math.random() * 8)]}${Math.floor(Math.random() * 5) + 1}班`);

/** 1x1 白 JPEG，够真实到能让 <img> 显示出图，又不占空间 */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHD8Q' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const chance = (p) => Math.random() < p;

// ---------------------------------------------------------------- 清理

async function clearDemo(conn) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS n FROM daka_participant WHERE phone LIKE ?`,
    [`${DEMO_PREFIX}%`]
  );
  const people = Number(row.n);

  // 先记下要删的文件，删库之后文件路径就查不到了
  const [media] = await conn.query(
    `SELECT m.object_key FROM daka_media m
       JOIN daka_participant p ON p.id = m.participant_id
      WHERE p.phone LIKE ?`,
    [`${DEMO_PREFIX}%`]
  );

  // 外键都是 ON DELETE CASCADE，删参与者就够了
  await conn.query('DELETE FROM daka_participant WHERE phone LIKE ?', [`${DEMO_PREFIX}%`]);
  await conn.query('DELETE FROM daka_batch WHERE participant_id NOT IN (SELECT id FROM daka_participant)');

  let files = 0;
  if (config.storage.driver === 'local') {
    const ROOT = path.resolve(config.root, config.storage.local.dir.replace(/^\.\//, ''));
    media.forEach((m) => {
      const abs = path.resolve(ROOT, String(m.object_key));
      if (abs.startsWith(path.resolve(ROOT))) {
        try { fs.unlinkSync(abs); files += 1; } catch (e) { /* 文件本来就没了也算清理完成 */ }
      }
    });
  }

  console.log(`  已清理演示数据：${people} 人，连带打卡记录与 ${files} 个占位文件`);
}

// ---------------------------------------------------------------- 生成

async function main() {
  const peopleCount = Number(arg('people', 60));
  const density = Number(arg('density', 0.62)); // 每天参与的概率
  const videoRate = Number(arg('video-rate', 0.15));

  console.log('\n清城少年志 · 演示数据生成');
  console.log(`  目标库 ${config.db.host}:${config.db.port}/${config.db.database}`);
  console.log(`  参与者 ${peopleCount} 人，每日参与率约 ${(density * 100).toFixed(0)}%\n`);

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: 'utf8mb4',
    timezone: '+08:00',
    // 必须与 src/db.js 一致：否则 SELECT 出来的 DATE 是 JS Date 对象，
    // 拼进 datetime 字符串会变成 "Thu Oct 01 2026 00:00:00 GMT+0800 ..."
    dateStrings: true,
    connectTimeout: 20000,
  });

  try {
    if (flagOn('clear')) {
      await clearDemo(conn);
      console.log('');
      return;
    }

    // 每次都从干净状态开始，避免重复跑出双份数据
    await clearDemo(conn);

    // ---- 0. 确认任务字典在 ----
    const [[taskCount]] = await conn.query('SELECT COUNT(*) AS n FROM daka_task');
    if (Number(taskCount.n) === 0) {
      console.error('  任务字典是空的，请先执行：node db/init.js\n');
      return;
    }

    const [tasks] = await conn.query(
      'SELECT id, day_date, theme, task_name, is_offline FROM daka_task ORDER BY day_date, sort_no'
    );
    const byDate = new Map();
    tasks.forEach((t) => {
      if (!byDate.has(t.day_date)) byDate.set(t.day_date, []);
      byDate.get(t.day_date).push(t);
    });

    // ---- 1. 参与者 ----
    const names = makeNames(peopleCount);
    const participantIds = [];

    for (let i = 0; i < peopleCount; i += 1) {
      const phone = `${DEMO_PREFIX}${String(randInt(0, 99999999)).padStart(8, '0')}`;
      const school = pick(SCHOOLS);
      const createdAt = `${DAYS[0].date} ${String(randInt(6, 22)).padStart(2, '0')}:${String(randInt(0, 59)).padStart(2, '0')}:00`;
      try {
        const [r] = await conn.query(
          'INSERT INTO daka_participant (phone, name, school, created_at) VALUES (?,?,?,?)',
          [phone, names[i], school, createdAt]
        );
        participantIds.push(r.insertId);
      } catch (e) {
        // 手机号撞了（概率极低）就跳过，不影响整体
        if (e.code !== 'ER_DUP_ENTRY') throw e;
      }
    }
    console.log(`  参与者 ${participantIds.length} 人写入完成`);

    // ---- 2. 打卡记录 + 凭证台账 ----
    const uploadRoot = path.resolve(config.root, config.storage.local.dir.replace(/^\.\//, ''));
    const localDriver = config.storage.driver === 'local';
    if (localDriver) fs.mkdirSync(uploadRoot, { recursive: true });

    // 让某些任务天生比别的热，这样"当日最多/最少项目"出来才有区分度
    const busyLevel = new Map();
    tasks.forEach((t) => busyLevel.set(t.id, 0.5 + Math.random() * 1.6));

    /** 写一个占位文件到上传目录，返回 objectKey */
    const writePlaceholder = (date, pid, type) => {
      const rand = Math.random().toString(36).slice(2, 8);
      const key = `daka/2026/${date}/${pid}/${type}/demo-${Date.now().toString(36)}-${rand}.jpg`;
      if (localDriver) {
        const abs = path.resolve(uploadRoot, key);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, TINY_JPEG);
      }
      return key;
    };

    let checkins = 0;
    let mediaCount = 0;
    let batches = 0;
    let seq = 0;

    for (const pid of participantIds) {
      // 每个人的活跃度不同，打卡天数分布才不会是一条平线
      const personal = 0.35 + Math.random() * 0.85;

      for (const [date, dayTasks] of byDate) {
        if (!chance(Math.min(0.95, density * personal))) continue;

        // 这一天挑几个主题：先按"任务热度"抽，再截到 1-4 个
        const shuffled = [...dayTasks].sort(() => Math.random() - 0.5);
        const picked = shuffled.filter((t) => chance(busyLevel.get(t.id) / 2)).slice(0, randInt(1, 4));
        if (!picked.length) picked.push(shuffled[0]);

        // 一次选多项时，有时一次提交，有时拆成多次提交 —— 两种都要能统计对
        const chunkSize = picked.length > 1 && chance(0.4) ? randInt(2, picked.length) : picked.length;
        const chunks = [];
        for (let i = 0; i < picked.length; i += chunkSize) chunks.push(picked.slice(i, i + chunkSize));

        for (const chunk of chunks) {
          seq += 1;
          const time = `${date} ${String(randInt(7, 22)).padStart(2, '0')}:${String(randInt(0, 59)).padStart(2, '0')}:${String(randInt(0, 59)).padStart(2, '0')}`;
          const requestId = `demo-${pid}-${seq}-${Math.random().toString(36).slice(2, 8)}`;

          const [br] = await conn.query(
            `INSERT INTO daka_batch
               (request_id, participant_id, checkin_date, item_count, photo_count, video_count, created_at)
             VALUES (?,?,?,?,0,0,?)`,
            [requestId, pid, date, chunk.length, time]
          );
          const batchId = br.insertId;
          batches += 1;

          let photoCount = 0;
          let videoCount = 0;

          for (const t of chunk) {
            await conn.query(
              `INSERT INTO daka_checkin
                 (batch_id, participant_id, checkin_date, task_id, theme, task_name, is_offline, created_at)
               VALUES (?,?,?,?,?,?,?,?)`,
              [batchId, pid, date, t.id, t.theme, t.task_name, t.is_offline, time]
            );
            checkins += 1;

            // 每项 1-3 张照片（照片必填）
            const photos = randInt(1, 3);
            for (let i = 0; i < photos; i += 1) {
              const key = writePlaceholder(date, pid, 'image');
              await conn.query(
                `INSERT INTO daka_media
                   (participant_id, batch_id, task_id, media_type, storage, object_key, file_name,
                    file_size, mime, status, sort_no, created_at)
                 VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`,
                [pid, batchId, t.id, 'image', config.storage.driver, key, 'demo.jpg',
                  TINY_JPEG.length, 'image/jpeg', i, time]
              );
              mediaCount += 1;
              photoCount += 1;
            }

            // 一部分人额外传一段视频
            if (chance(videoRate) && videoRate > 0) {
              const key = writePlaceholder(date, pid, 'video');
              await conn.query(
                `INSERT INTO daka_media
                   (participant_id, batch_id, task_id, media_type, storage, object_key, file_name,
                    file_size, mime, duration, status, sort_no, created_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,1,0,?)`,
                [pid, batchId, t.id, 'video', config.storage.driver, key, 'demo.mp4',
                  800 * 1024, 'video/mp4', randInt(10, 60), time]
              );
              mediaCount += 1;
              videoCount += 1;
            }
          }

          await conn.query(
            'UPDATE daka_batch SET photo_count = ?, video_count = ? WHERE id = ?',
            [photoCount, videoCount, batchId]
          );
        }
      }
    }

    console.log(`  批次 ${batches} 次 / 打卡明细 ${checkins} 条 / 凭证 ${mediaCount} 个`);
    console.log('');

    const [[s]] = await conn.query(
      `SELECT (SELECT COUNT(*) FROM daka_participant) AS people,
              (SELECT COUNT(*) FROM daka_checkin) AS checks,
              (SELECT COUNT(DISTINCT theme) FROM daka_checkin) AS themes`
    );
    console.log(`  当前库内：参与者 ${s.people} 人 / 打卡 ${s.checks} 次 / 覆盖 ${s.themes} 个主题`);
    console.log('  验收完记得清掉：node db/demo-data.js --clear\n');
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('\n生成失败：', e.code || '', e.message);
  if (e.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('数据库账号没有权限，先在服务器上授权后再试。');
  }
  process.exit(1);
});
