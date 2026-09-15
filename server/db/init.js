'use strict';

/**
 * 数据库初始化：建表 → 灌任务字典 → 建管理员 → 写默认配置。
 *
 * 设计成幂等的：重复执行只会补齐缺的东西，不会清空已有数据。
 * 用 CREATE TABLE IF NOT EXISTS + INSERT ... ON DUPLICATE KEY UPDATE，
 * 所以「活动开始后发现少了一项任务，补一条再跑一次」是安全的。
 *
 * 用法：
 *   node db/init.js              正常初始化
 *   node db/init.js --drop       先删表再重建（仅限本地/测试，活动期间千万别用）
 *   node db/init.js --admin-only 只重置管理员密码
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const config = require('../src/config');
const { DAYS, THEMES } = require('./tasks-data');

const flag = (name) => process.argv.includes(`--${name}`);

/** 从 .env 或参数里取一个"管理员直连"配置（建库需要更高权限时用 --root） */
function baseConn(overrides = {}) {
  return {
    host: config.db.host,
    port: config.db.port,
    user: overrides.user || config.db.user,
    password: overrides.password !== undefined ? overrides.password : config.db.password,
    charset: 'utf8mb4',
    timezone: '+08:00',
    // 与 src/db.js 保持一致：DATE/DATETIME 一律拿字符串，
    // 免得 Date 对象被拼进 SQL 字符串后变成 "Thu Oct 01 2026 ..."
    dateStrings: true,
    connectTimeout: 20000,
    multipleStatements: false,
  };
}

/**
 * 把 schema.sql 拆成单条语句。
 * 不能直接把整份丢进去执行 —— mysql2 默认 multipleStatements: false，
 * 而且开着它跑 DDL 是可被注入的坏习惯，这里宁可按分号手动拆。
 */
function splitStatements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function ensureDatabase() {
  const rootUser = pickArg('--root-user') || 'root';
  const rootPwd = pickArg('--root-password') ?? '';
  let conn;
  try {
    conn = await mysql.createConnection(baseConn({ user: rootUser, password: rootPwd }));
  } catch (e) {
    // 没有高权限账号是常态（云数据库一般只给业务账号）。库已经存在就没事。
    if (e.code === 'ER_ACCESS_DENIED_ERROR') {
      console.log(`  跳过建库（${rootUser} 账号不可用），假定库 ${config.db.database} 已存在`);
      return;
    }
    throw e;
  }
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\`
       DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.end();
  console.log(`  数据库 ${config.db.database} 就绪`);
}

function pickArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function runSchema(conn) {
  const sqlPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const statements = splitStatements(sql);
  for (const stmt of statements) {
    await conn.query(stmt);
  }
  console.log(`  建表完成（${statements.length} 条语句）`);
}

async function dropAll(conn) {
  // 有外键，顺序不能反
  const tables = ['daka_oplog', 'daka_media', 'daka_checkin', 'daka_batch', 'daka_task', 'daka_participant', 'daka_config', 'daka_admin'];
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tables) await conn.query(`DROP TABLE IF EXISTS \`${t}\``);
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  console.log('  已删除全部业务表');
}

async function seedTasks(conn) {
  let inserted = 0;
  let updated = 0;

  for (const day of DAYS) {
    for (let i = 0; i < day.tasks.length; i += 1) {
      const t = day.tasks[i];
      const [r] = await conn.query(
        `INSERT INTO daka_task
           (day_date, day_no, weekday, theme, task_name, task_desc, task_how, is_offline, offline_point, sort_no)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           day_no = VALUES(day_no), weekday = VALUES(weekday),
           task_name = VALUES(task_name), task_desc = VALUES(task_desc),
           task_how = VALUES(task_how), is_offline = VALUES(is_offline),
           offline_point = VALUES(offline_point), sort_no = VALUES(sort_no)`,
        [
          day.date, day.dayNo, day.weekday, t.theme, t.name, t.desc || '', t.how || '',
          t.offline ? 1 : 0, t.offline ? (day.offline || '') : '', THEMES.indexOf(t.theme),
        ]
      );
      // affectedRows: 1=新插, 2=有更新, 0=完全没变
      if (r.affectedRows === 1) inserted += 1;
      else if (r.affectedRows === 2) updated += 1;
    }
  }

  const [[cnt]] = await conn.query('SELECT COUNT(*) AS n FROM daka_task');
  console.log(`  任务字典：新增 ${inserted}，更新 ${updated}，库内共 ${cnt.n} 项`);
  if (Number(cnt.n) !== 49) {
    console.log(`  ⚠ 预期 49 项，实际 ${cnt.n} 项，请核对 tasks-data.js`);
  }
}

async function seedAdmin(conn) {
  const username = config.adminInit.username;
  const password = config.adminInit.password;

  const [[exists]] = await conn.query('SELECT id FROM daka_admin WHERE username = ?', [username]);

  if (exists && !flag('admin-only')) {
    console.log(`  管理员 ${username} 已存在，未改动密码`);
    return;
  }
  if (!exists && !password) {
    console.log('  ⚠ 未设置 ADMIN_INIT_PASSWORD，跳过管理员创建（.env 里补上再重跑）');
    return;
  }

  const hash = bcrypt.hashSync(password || 'admin12345', 10);
  await conn.query(
    `INSERT INTO daka_admin (username, password_hash, display_name) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    [username, hash, '活动管理员']
  );
  console.log(`  管理员 ${username} 就绪${exists ? '（密码已重置）' : ''}`);
}

async function seedConfig(conn) {
  const settings = require('../src/services/settings');
  const entries = Object.entries(settings.DEFAULTS);
  for (const [k, v] of entries) {
    await conn.query(
      `INSERT INTO daka_config (k, v, label) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE label = VALUES(label)`,
      [k, String(v), settings.LABELS[k] || '']
    );
  }
  console.log(`  默认配置 ${entries.length} 项就绪（已有值不会被覆盖）`);
}

async function main() {
  console.log('\n清城少年志 · 数据库初始化');
  console.log(`  目标 ${config.db.host}:${config.db.port}  库 ${config.db.database}  账号 ${config.db.user}\n`);

  if (flag('drop')) {
    console.log('  ⚠ --drop 已启用：将删除所有业务表与数据');
  }

  await ensureDatabase();

  const conn = await mysql.createConnection({ ...baseConn(), database: config.db.database });

  try {
    if (flag('drop')) await dropAll(conn);
    await runSchema(conn);
    if (!flag('admin-only')) {
      await seedTasks(conn);
      await seedConfig(conn);
    }
    await seedAdmin(conn);

    const [[t]] = await conn.query(
      `SELECT (SELECT COUNT(*) FROM daka_task) AS tasks,
              (SELECT COUNT(*) FROM daka_participant) AS people,
              (SELECT COUNT(*) FROM daka_checkin) AS checks`
    );
    console.log(`\n  完成。当前库内：任务 ${t.tasks} 项 / 参与者 ${t.people} 人 / 打卡 ${t.checks} 次`);
    console.log(`  管理后台账号：${config.adminInit.username}\n`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('\n初始化失败：', e.code || '', e.message);
  if (e.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('\n这个账号没有被授权从当前机器访问数据库。需要数据库管理员执行：');
    console.error(`  CREATE USER IF NOT EXISTS '${config.db.user}'@'%' IDENTIFIED BY '<密码>';`);
    console.error(`  GRANT ALL PRIVILEGES ON \\\`${config.db.database}\\\`.* TO '${config.db.user}'@'%';`);
    console.error('  FLUSH PRIVILEGES;');
  }
  process.exit(1);
});
