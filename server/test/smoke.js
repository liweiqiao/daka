'use strict';

/**
 * 接口验收脚本 —— 不依赖浏览器，直接用 HTTP 打一遍关键链路。
 *
 * 覆盖：健康检查 → 登记 → 任务字典 → 领凭证 → 上传 → 提交打卡 →
 *      重复提交拦截 → 空白提交拦截 → 我的记录 → 公开照片墙 → 后台统计/导出
 *
 * 用法：
 *   node test/smoke.js                         打本机 3000
 *   node test/smoke.js --base=https://xxx.com  打线上
 *   node test/smoke.js --admin-user=admin --admin-pass=xxx
 *
 * 不传 --admin-pass 时会去 server/.env 读 ADMIN_INIT_PASSWORD 兜底，
 * 所以 `npm run smoke` 可以直接跑，不用把密码写进 package.json。
 *
 * 退出码 0 = 全部通过；非 0 = 有断言失败。可以直接接进 CI 或上线前手动跑一遍。
 */

// 先加载 .env，后面取默认管理员密码要用
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};

const BASE = arg('base', 'http://127.0.0.1:3000').replace(/\/+$/, '');
const ADMIN_USER = arg('admin-user', process.env.ADMIN_INIT_USER || 'admin');
const ADMIN_PASS = arg('admin-pass', process.env.ADMIN_INIT_PASSWORD || '');

let pass = 0;
let fail = 0;
const failures = [];
/**
 * 被跳过的段落。
 * 必须记下来并在结论里说出来 —— 否则「通过 32 项」看起来像全绿，
 * 实际上是后台那一整段（17 项）根本没跑，是最容易骗到自己的一种"通过"。
 */
const skippedSections = [];

function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else {
    fail += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${extra ? '  → ' + JSON.stringify(extra).slice(0, 200) : ''}`);
  }
}

async function call(pathname, { method = 'GET', body, token, form, expectFail = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  // multipart 单独走一条路：Content-Type 必须交给 fetch 自己带 boundary
  if (form) {
    const res = await fetch(BASE + pathname, { method, headers, body: form });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* 可能是二进制 */ }
    if (!expectFail && res.status >= 400) {
      throw new Error(`${method} ${pathname} → ${res.status} ${text.slice(0, 200)}`);
    }
    return { status: res.status, json, text, headers: res.headers };
  }

  const res = await fetch(BASE + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON（比如 CSV/zip） */ }

  if (!expectFail && res.status >= 400) {
    throw new Error(`${method} ${pathname} → ${res.status} ${text.slice(0, 200)}`);
  }
  return { status: res.status, json, text, headers: res.headers };
}

// 一个最小的合法 JPEG，用来测上传链路
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHD8Q' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

const rid = () => 'smoke-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

async function main() {
  console.log(`\n清城少年志 · 打卡工具接口验收`);
  console.log(`  目标 ${BASE}\n`);

  // ---------------------------------------------------------- 1. 健康检查
  console.log('[1] 健康检查与基础接口');
  const health = await call('/api/health');
  ok('GET /api/health 返回 ok', health.json && health.json.ok === true);
  ok('数据库连接正常', health.json && health.json.data.db && health.json.data.db.ok === true,
    health.json && health.json.data.db);

  const activity = await call('/api/activity');
  ok('GET /api/activity 返回活动信息', activity.json && activity.json.data && !!activity.json.data.title);

  const tasks = await call('/api/tasks');
  const days = (tasks.json && tasks.json.data.days) || [];
  const taskCount = days.reduce((n, d) => n + d.tasks.length, 0);
  ok('GET /api/tasks 返回 7 天任务字典', days.length === 7, { days: days.length });
  ok('任务总数 = 49', taskCount === 49, { taskCount });

  // ---------------------------------------------------------- 2. 登记
  console.log('\n[2] 参与者登记');
  const phone = '199' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
  // 姓名走的是服务端 assertName 校验（只允许中文/字母），所以造名得用汉字，
  // 不能拿随机字母数字拼 —— 否则测的是校验本身，不是登记链路
  const CN = '验收自动化样例测试甲乙丙丁戊己庚辛';
  const name = '验收' + CN[Math.floor(Math.random() * CN.length)] + CN[Math.floor(Math.random() * CN.length)];
  const reg = await call('/api/participant/register', {
    method: 'POST',
    body: { name, school: '验收测试学校 五年级1班', phone },
  });
  ok('POST /api/participant/register 成功', reg.json && reg.json.ok === true);
  const token = reg.json && reg.json.data && reg.json.data.token;
  ok('拿到参与者 token', !!token);
  ok('返回 isNew=true', reg.json && reg.json.data.isNew === true);
  ok('返回同名检测字段', reg.json && typeof reg.json.data.sameName === 'object');

  const reg2 = await call('/api/participant/register', {
    method: 'POST',
    body: { name, school: '验收测试学校 五年级1班', phone },
  });
  ok('重复登记不新增（isNew=false）', reg2.json && reg2.json.data.isNew === false);

  const badPhone = await call('/api/participant/register', {
    method: 'POST',
    body: { name: '测试甲', school: '测试学校', phone: '12345' },
    expectFail: true,
  });
  ok('非法手机号被拒（400）', badPhone.status === 400);

  const me = await call('/api/me', { token });
  ok('GET /api/me 返回个人信息', me.json && me.json.data && me.json.data.participant.name === name);
  ok('返回今日任务列表', me.json && me.json.data.today && me.json.data.today.tasks.length === 7);
  const initialTotal = me.json.data.progress.total;
  ok('初始累计次数为 0', initialTotal === 0, { initialTotal });

  // ---------------------------------------------------------- 3. 上传
  console.log('\n[3] 上传凭证');
  const limits = await call('/api/upload/limits');
  const photoLimit = limits.json.data.photo;
  ok('GET /api/upload/limits 返回照片限制', !!photoLimit && photoLimit.maxCount > 0);

  const ticket = await call('/api/upload/ticket', {
    method: 'POST',
    token,
    body: { type: 'image', mime: 'image/jpeg', size: TINY_JPEG.length, fileName: 'smoke.jpg' },
  });
  ok('POST /api/upload/ticket 签发凭证', ticket.json && !!ticket.json.data.key);
  const key = ticket.json.data.key;
  const mode = ticket.json.data.mode;

  let uploaded = false;
  if (mode === 'local') {
    const form = new FormData();
    form.append('file', new Blob([TINY_JPEG], { type: 'image/jpeg' }), 'smoke.jpg');
    const up = await call(`/api/upload/local?key=${encodeURIComponent(key)}`, { method: 'POST', token, form });
    uploaded = !!(up.json && up.json.ok);
    ok('POST /api/upload/local 上传成功', uploaded, up.json);
  } else {
    // 七牛模式直传，这里只确认拿到了 token 与上传地址
    ok('七牛模式签发了 token 与上传地址', !!ticket.json.data.token && !!ticket.json.data.uploadHost);
    uploaded = true;
  }

  // ---------------------------------------------------------- 4. 提交打卡
  console.log('\n[4] 提交打卡');
  // 今天不一定是活动期内，所以直接取"第一天的任务"来测；
  // 若服务端判定不是今天，会走 NOT_TODAY 分支，这里用断言覆盖两种结果
  const todayTasks = me.json.data.today.tasks;
  const target = todayTasks[0];

  const submitBody = {
    requestId: rid(),
    items: [{ taskId: target.id, remark: '接口验收自动提交', media: [{ type: 'image', key }] }],
  };
  const sub = await call('/api/checkin', { method: 'POST', token, body: submitBody });
  ok('POST /api/checkin 返回 ok', sub.json && sub.json.ok === true);
  const d = sub.json.data;
  const acceptedNow = d.accepted.length > 0;

  if (acceptedNow) {
    ok('打卡被接受 1 项', d.accepted.length === 1, d.accepted);
    ok('累计次数 +1', d.progress.total === initialTotal + 1, { before: initialTotal, after: d.progress.total });
  } else {
    ok('非活动期时给出原因而不是硬报错', d.skipped.length > 0, d.skipped);
    console.log(`    （当前不在活动期，跳过打卡成功断言：${d.message}）`);
  }

  // 幂等：同一个 requestId 再发一次，不应该产生第二条
  const replay = await call('/api/checkin', { method: 'POST', token, body: submitBody });
  ok('同一 requestId 重发被幂等处理', replay.json.data.replay === true, replay.json.data);

  // 重复提交同一任务：换新 requestId + 新 key，应被 uk_once 拦住
  if (acceptedNow) {
    const t2 = await call('/api/upload/ticket', {
      method: 'POST', token,
      body: { type: 'image', mime: 'image/jpeg', size: TINY_JPEG.length, fileName: 'smoke2.jpg' },
    });
    if (mode === 'local') {
      const form2 = new FormData();
      form2.append('file', new Blob([TINY_JPEG], { type: 'image/jpeg' }), 'smoke2.jpg');
      await call(`/api/upload/local?key=${encodeURIComponent(t2.json.data.key)}`, { method: 'POST', token, form: form2 });
    }
    const dup = await call('/api/checkin', {
      method: 'POST', token,
      body: {
        requestId: rid(),
        items: [{ taskId: target.id, media: [{ type: 'image', key: t2.json.data.key }] }],
      },
    });
    ok('重复提交同一主题被过滤（accepted=0）', dup.json.data.accepted.length === 0, dup.json.data);
    ok('过滤原因标注为重复', dup.json.data.skipped.some((s) => s.reason === 'DUPLICATE'), dup.json.data.skipped);
  }

  // 空白提交：没有照片
  const blank = await call('/api/checkin', {
    method: 'POST', token,
    body: { requestId: rid(), items: [{ taskId: target.id, media: [] }] },
  });
  ok('空白提交被过滤（accepted=0）', blank.json.data.accepted.length === 0, blank.json.data);

  // 完全没选任务
  const noItem = await call('/api/checkin', {
    method: 'POST', token,
    body: { requestId: rid(), items: [] },
    expectFail: true,
  });
  ok('不选任何任务被拒（400）', noItem.status === 400);

  // 未登录提交
  const noAuth = await call('/api/checkin', {
    method: 'POST',
    body: { requestId: rid(), items: [{ taskId: target.id, media: [] }] },
    expectFail: true,
  });
  ok('未登录提交被拒（401）', noAuth.status === 401);

  // ---------------------------------------------------------- 5. 我的记录
  console.log('\n[5] 我的记录');
  const rec = await call('/api/me/records', { token });
  ok('GET /api/me/records 返回按天分组', rec.json && Array.isArray(rec.json.data.days));
  ok('记录里带进度信息', rec.json && !!rec.json.data.progress);

  // ---------------------------------------------------------- 6. 公开照片墙
  console.log('\n[6] 公开照片墙（清城少年立志瞬间）');
  const gallery = await call('/api/gallery', { expectFail: true });
  if (gallery.status === 200) {
    const g = gallery.json.data;
    ok('照片墙返回数据对象（items 数组 + total 数字）',
      Array.isArray(g.items) && typeof g.total === 'number', g);
    if (g.items.length) {
      ok('照片墙每条带脱敏姓名与图片地址',
        g.items.every((p) => typeof p.name === 'string' && !!p.url), g.items[0]);
      ok('照片墙姓名已脱敏（张*三式）',
        g.items.every((p) => p.name.includes('*') || p.name.length <= 2), g.items[0]);
      ok('照片墙只展示图片（不含视频）',
        g.items.every((p) => p.type === 'image'), g.items[0]);
    } else {
      console.log('    （当前尚未有打卡照片，照片墙返回空列表，属正常空态）');
    }
  } else {
    console.log(`    （照片墙未公开，status=${gallery.status}，跳过相关断言）`);
  }

  // ---------------------------------------------------------- 7. 后台
  console.log('\n[7] 后台统计');
  if (!ADMIN_PASS) {
    skippedSections.push('后台统计与导出（未提供 --admin-pass，也未在 .env 里读到 ADMIN_INIT_PASSWORD）');
    console.log('    （未提供 --admin-pass，跳过后台断言）');
    console.log('    提示：加 --admin-pass=<ADMIN_INIT_PASSWORD> 可完整验收后台。\n');
    return;
  }

  const login = await call('/api/admin/login', {
    method: 'POST',
    body: { username: ADMIN_USER, password: ADMIN_PASS },
    expectFail: true,
  });
  if (login.status === 429) {
    // 限流是正确的安全设计，不该为了让验收通过而放宽。
    // 但必须明确说出来 —— 否则「通过 32 项」会被误读成全绿。
    skippedSections.push('后台统计与导出（登录接口 10 次/10 分钟限流，等 10 分钟或重启服务再跑）');
    console.log('    ⚠ 后台登录被限流（10 次/10 分钟），跳过后台断言。');
    console.log('      这是正确的安全行为，不是失败。等 10 分钟或重启后端可清零计数。\n');
    return;
  }
  ok('后台登录成功', login.status === 200 && login.json.ok === true, login.json);
  const at = login.json && login.json.data && login.json.data.token;
  if (!at) {
    skippedSections.push('后台统计与导出（拿不到后台 token）');
    console.log('    （拿不到后台 token，后续断言跳过）\n');
    return;
  }

  const dash = await call('/api/admin/dashboard', { token: at });
  const dd = dash.json.data;
  ok('后台总览返回四类汇总', !!dd.overview && !!dd.daily && !!dd.trend && !!dd.matrix);
  ok('总览含累计打卡次数', typeof dd.overview.totalCheckins === 'number');
  ok('总览含累计打卡人数', typeof dd.overview.totalPeople === 'number');
  ok('当日最多项目非空', Array.isArray(dd.daily.max), dd.daily.max);
  ok('当日最少项目非空', Array.isArray(dd.daily.min), dd.daily.min);
  ok('矩阵为 7 天 × 7 主题', dd.matrix.cells.length === 49, { cells: dd.matrix.cells.length });
  ok('学校排行是数组', Array.isArray(dd.schools));

  const honors = await call('/api/admin/honors?types=allRound,themeCert', { token: at });
  ok('荣誉名单返回两类', !!(honors.json.data.allRound && honors.json.data.themeCert));
  ok('荣誉门槛已下发', !!honors.json.data.thresholds);

  const dups = await call('/api/admin/duplicates', { token: at });
  ok('重名检测返回数组', Array.isArray(dups.json.data.duplicates));

  const checkins = await call('/api/admin/checkins?pageSize=5', { token: at });
  ok('打卡明细分页正常', checkins.json.data.list.length <= 5 && typeof checkins.json.data.total === 'number');

  const media = await call('/api/admin/media?status=all', { token: at });
  ok('附件台账返回汇总', !!media.json.data.summary && typeof media.json.data.summary.totalCount === 'number');
  ok('附件台账返回分页总数', typeof media.json.data.total === 'number');

  const settings = await call('/api/admin/settings', { token: at });
  ok('设置接口返回配置与标签', !!settings.json.data.values && !!settings.json.data.labels);

  // 导出（只验状态码与 Content-Type，不落盘）
  const csv = await call('/api/admin/export/checkins', { token: at });
  ok('导出打卡明细 CSV 成功', csv.status === 200 && csv.text.includes('日期'));

  const csvZip = await call('/api/admin/export/media.zip?maxFiles=1', { token: at, expectFail: true });
  ok('附件打包路由未被 /export/:type 抢占',
    csvZip.status === 200 || csvZip.status === 404,
    { status: csvZip.status, body: String(csvZip.text).slice(0, 120) });

  console.log('');
}

main()
  .then(() => {
    console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
    if (fail) {
      console.log('失败项：');
      failures.forEach((f) => console.log('  - ' + f));
    }
    if (skippedSections.length) {
      console.log('未执行的段落（不代表通过）：');
      skippedSections.forEach((s) => console.log('  ! ' + s));
    }
    console.log('');
    // 有段落被跳过时退出码给 3，方便串在 `npm run verify` 里时能看出来
    // 这一轮并不完整 —— 光看「失败 0 项」会以为全都验过了。
    process.exit(fail ? 1 : (skippedSections.length ? 3 : 0));
  })
  .catch((e) => {
    console.error('\n验收中断：' + e.message + '\n');
    process.exit(2);
  });
