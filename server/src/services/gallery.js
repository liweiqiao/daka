'use strict';

/**
 * 「清城少年立志瞬间」——参与者端照片墙。
 *
 * 只做一件事：把最近完成打卡、且真的带照片的记录挑出来给首页展示。
 *
 * 几个刻意的取舍：
 *   1. 只认"真的落库的打卡"：照片必须绑在 daka_checkin 的那条记录上
 *      （batch_id + task_id 都对得上），所以被自动过滤掉的重复提交、
 *      没照片的提交，绝不会漏到墙上。视频不上墙，只上照片。
 *   2. 一个孩子一次只占一个位置：按 participant 去重。
 *      否则某天有几个孩子连着传了九张，整面墙就全是他们家的。
 *   3. 姓名脱敏（沿用战报那套"张*三"规则）：这是一面公开的墙，
 *      拿链接的人不需要知道孩子叫什么。学校、手机号一律不给。
 *   4. 默认给 30 个候选点，前端一次只显示 5 个、按时间往下滚，
 *      所以这里返回的是一个"池子"，不是一屏。
 */

const db = require('../db');
const sql = require('../sql');
const stats = require('./stats');
const { getStorage } = require('../storage');

/**
 * @param {number} limit 池子大小（前端轮播用），5~60
 * @param {{origin?:string}} opts
 * @returns {Promise<{items:Array,total:number,updatedAt:string}>}
 */
async function recentPhotos(limit = 30, { origin } = {}) {
  const lim = sql.int(limit, 30, { min: 5, max: 60 });

  /**
   * 一次查询里取每组照片的第一张。
   * 用相关子查询而不是 GROUP BY：MySQL 8.0 开了 ONLY_FULL_GROUP_BY 之后
   * "GROUP BY c.id 却 select 别的表字段"会直接报错，子查询两个版本都稳。
   * LIMIT 乘 4 是给"按人去重"留余量，夹紧后内联（占位符在 LIMIT 上不可靠）。
   */
  const rows = await db.q(
    `SELECT c.id, c.theme, c.task_name, c.checkin_date, c.created_at,
            p.id AS pid, p.name AS pname,
            (SELECT m.object_key FROM daka_media m
              WHERE m.batch_id = c.batch_id AND m.task_id = c.task_id
                AND m.status = 1 AND m.media_type = 'image'
              ORDER BY m.sort_no, m.id LIMIT 1) AS object_key
       FROM daka_checkin c
       JOIN daka_participant p ON p.id = c.participant_id
      WHERE EXISTS (
              SELECT 1 FROM daka_media m2
               WHERE m2.batch_id = c.batch_id AND m2.task_id = c.task_id
                 AND m2.status = 1 AND m2.media_type = 'image')
      ORDER BY c.id DESC
      LIMIT ${lim * 4}`
  );

  const totalRow = await db.one(
    `SELECT COUNT(*) AS n FROM daka_checkin c
      WHERE EXISTS (
              SELECT 1 FROM daka_media m
               WHERE m.batch_id = c.batch_id AND m.task_id = c.task_id
                 AND m.status = 1 AND m.media_type = 'image')`
  );

  const storage = getStorage();
  const seen = new Set();
  const items = [];

  for (const r of rows) {
    if (items.length >= lim) break;
    if (seen.has(r.pid)) continue;
    if (!r.object_key) continue;
    seen.add(r.pid);
    items.push({
      key: r.object_key,
      url: storage.mediaUrl(r.object_key, { origin, expiresIn: 7200 }),
      // SQL 里已经用 media_type='image' 过滤，这里显式带出去：
      // 一方面验收断言直接认这个字段，另一方面前端以后要混排音视频时不用再从 key 里猜
      type: 'image',
      theme: r.theme,
      taskName: r.task_name,
      name: stats.maskName(r.pname),
      date: r.checkin_date,
      at: r.created_at,
    });
  }

  return {
    items,
    total: Number(totalRow && totalRow.n) || 0,
    updatedAt: require('../time').nowStr(),
  };
}

module.exports = { recentPhotos };
