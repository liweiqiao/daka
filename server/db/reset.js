/**
 * 清空业务数据（保留任务字典 daka_task 与管理员账号 daka_admin）。
 *
 * 用途：
 *   · 演示数据 / 验收测试数据跑完后，正式活动开始前必须清一次，否则统计里混着假数据。
 *   · 活动周期里如果误操作需要回滚，也可以用它把某天的数据清掉。
 *
 * 用法：
 *   node db/reset.js                 清空全部打卡业务数据（会二次确认）
 *   node db/reset.js --yes           跳过确认
 *   node db/reset.js --date=2026-10-01   只清某一天的打卡（参与者档案保留）
 *   node db/reset.js --keep-tasks-only   同全清，但额外强调任务字典不动（默认行为）
 */
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const config = require('../src/config');

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const flag = (name) => process.argv.includes(`--${name}`);

const onlyDate = arg('date', '');
const yes = flag('yes');

/** 删除上传目录里对应的文件（本地驱动才有意义） */
function purgeLocalUploads(keys) {
  let removed = 0;
  let bytes = 0;
  const root = path.resolve(config.root, config.storage.local.dir.replace(/^\.\//, ''));
  for (const key of keys) {
    const p = path.join(root, key.replace(/^\/+/, ''));
    try {
      const st = fs.statSync(p);
      bytes += st.size;
      fs.unlinkSync(p);
      removed += 1;
    } catch (e) { /* 文件不在了就算了 */ }
  }
  return { removed, bytes };
}

(async () => {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: 'utf8mb4',
    timezone: '+08:00',
    dateStrings: true,
    connectTimeout: 20000,
  });

  const scope = onlyDate ? `仅 ${onlyDate} 这一天` : '全部业务数据';
  console.log('');
  console.log('  清空范围：' + scope);
  console.log('  保留不动：daka_task（49 项任务字典）、daka_admin（管理员）、daka_config（设置）');
  console.log('');

  if (!yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((res) => rl.question('  确认清空？输入 yes 继续：', res));
    rl.close();
    if (answer.trim().toLowerCase() !== 'yes') {
      console.log('  已取消，什么都没做。');
      await conn.end();
      return;
    }
  }

  // 先把要删的附件 key 捞出来，删库之后还能去磁盘/七牛上清文件
  let keys = [];
  let stats = { batches: 0, checkins: 0, media: 0, participants: 0 };

  if (onlyDate) {
    // daka_media 没有 checkin_date，日期只在 daka_batch 上，要 join 过去
    const [rows] = await conn.query(
      'SELECT m.object_key FROM daka_media m JOIN daka_batch b ON b.id = m.batch_id WHERE b.checkin_date = ?',
      [onlyDate]
    );
    keys = rows.map((r) => r.object_key);
  } else {
    const [rows] = await conn.query('SELECT object_key FROM daka_media');
    keys = rows.map((r) => r.object_key);
  }

  const before = await conn.query(`SELECT
    (SELECT COUNT(*) FROM daka_participant) p,
    (SELECT COUNT(*) FROM daka_batch) b,
    (SELECT COUNT(*) FROM daka_checkin) c,
    (SELECT COUNT(*) FROM daka_media) m`);
  stats = {
    participants: Number(before[0][0].p),
    batches: Number(before[0][0].b),
    checkins: Number(before[0][0].c),
    media: Number(before[0][0].m),
  };

  // 子表 → 父表顺序删，避免外键报错
  if (onlyDate) {
    await conn.query('DELETE m FROM daka_media m JOIN daka_batch b ON b.id = m.batch_id WHERE b.checkin_date = ?', [onlyDate]);
    await conn.query('DELETE FROM daka_checkin WHERE checkin_date = ?', [onlyDate]);
    await conn.query('DELETE FROM daka_batch WHERE checkin_date = ?', [onlyDate]);
  } else {
    await conn.query('DELETE FROM daka_media');
    await conn.query('DELETE FROM daka_checkin');
    await conn.query('DELETE FROM daka_batch');
    await conn.query('DELETE FROM daka_participant');
    await conn.query('ALTER TABLE daka_participant AUTO_INCREMENT = 1');
    await conn.query('ALTER TABLE daka_batch AUTO_INCREMENT = 1');
    await conn.query('ALTER TABLE daka_checkin AUTO_INCREMENT = 1');
    await conn.query('ALTER TABLE daka_media AUTO_INCREMENT = 1');
  }

  const after = await conn.query(`SELECT
    (SELECT COUNT(*) FROM daka_participant) p,
    (SELECT COUNT(*) FROM daka_batch) b,
    (SELECT COUNT(*) FROM daka_checkin) c,
    (SELECT COUNT(*) FROM daka_media) m,
    (SELECT COUNT(*) FROM daka_task) t`);
  const a = after[0][0];

  // 本地驱动才需要扫磁盘；七牛驱动下这里只提示 key 数量，删云文件请用七牛控制台或脚本
  let fileInfo = { removed: 0, bytes: 0 };
  if (config.storage.driver === 'local' && keys.length) {
    fileInfo = purgeLocalUploads(keys);
  }

  console.log('  清空结果：');
  console.log(`    参与者  ${stats.participants} → ${a.p}`);
  console.log(`    提交批次 ${stats.batches} → ${a.b}`);
  console.log(`    打卡明细 ${stats.checkins} → ${a.c}`);
  console.log(`    凭证台账 ${stats.media} → ${a.m}`);
  console.log(`    任务字典 ${a.t} 条（未动）`);
  if (keys.length) {
    if (config.storage.driver === 'local') {
      console.log(`    磁盘文件 删除 ${fileInfo.removed}/${keys.length} 个，释放 ${(fileInfo.bytes / 1048576).toFixed(2)}MB`);
    } else {
      console.log(`    七牛文件 ${keys.length} 个未删除，请到七牛控制台按前缀 daka/ 批量清理`);
    }
  }
  console.log('');
  await conn.end();
})().catch((e) => {
  console.error('  失败：', e.message);
  process.exit(1);
});
