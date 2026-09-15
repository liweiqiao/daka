'use strict';

/**
 * MySQL 连接池 + 一组查询助手。
 *
 * 关键设置说明：
 * - dateStrings: true  → DATE/DATETIME 直接返回字符串，绕开 Node 时区与 MySQL
 *   时区打架导致「10-03 变成 10-02」这类经典 bug。
 * - decimalNumbers: true → COUNT(*) 之类返回 Number 而不是字符串，省得到处 Number()。
 * - timezone '+08:00' → 与服务器同处北京时间，NOW() 与业务口径一致。
 */

const mysql = require('mysql2/promise');
const config = require('./config');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: config.db.connectionLimit,
      queueLimit: 0,
      charset: config.db.charset,
      timezone: config.db.timezone,
      dateStrings: true,
      decimalNumbers: true,
      namedPlaceholders: false,
      multipleStatements: false,
      // 公网库务必设超时，否则网络抖动会把请求挂死
      connectTimeout: 15000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    });
  }
  return pool;
}

/** 执行查询，返回 rows */
async function q(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

/** 只要一行，没有就返回 null */
async function one(sql, params = []) {
  const rows = await q(sql, params);
  return rows.length ? rows[0] : null;
}

/** INSERT，返回 insertId */
async function insert(sql, params = []) {
  const [r] = await getPool().execute(sql, params);
  return r.insertId;
}

/** UPDATE/DELETE，返回受影响行数 */
async function exec(sql, params = []) {
  const [r] = await getPool().execute(sql, params);
  return r.affectedRows;
}

/**
 * 事务：fn 收到一个 conn，其中的方法签名与上面一致。
 * 用法：
 *   await tx(async (c) => { await c.q(...); await c.insert(...); });
 */
async function tx(fn) {
  const conn = await getPool().getConnection();
  const api = {
    q: async (sql, p = []) => (await conn.execute(sql, p))[0],
    one: async (sql, p = []) => {
      const [rows] = await conn.execute(sql, p);
      return rows.length ? rows[0] : null;
    },
    insert: async (sql, p = []) => (await conn.execute(sql, p))[0].insertId,
    exec: async (sql, p = []) => (await conn.execute(sql, p))[0].affectedRows,
  };
  try {
    await conn.beginTransaction();
    const out = await fn(api);
    await conn.commit();
    return out;
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* 回滚失败也无能为力，抛出原错误更有用 */ }
    throw e;
  } finally {
    conn.release();
  }
}

/** 启动自检：连一次库，报告版本与关键参数 */
async function health() {
  const row = await one(
    'SELECT VERSION() AS version, DATABASE() AS db, @@character_set_database AS cs, @@time_zone AS tz, NOW() AS now'
  );
  return row;
}

async function close() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { getPool, q, one, insert, exec, tx, health, close };
