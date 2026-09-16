'use strict';

/**
 * 浏览器端验收 —— 用本机 Chrome 真跑一遍家长和活动方会做的动作。
 *
 * 为什么必须做这一步：接口全绿不等于页面能用。真实翻车点都在这一层 ——
 * 上传按钮点不开、提交按钮被吸底栏挡住、后台图表空白、控制台报错但接口正常。
 *
 * 用法（需要 server 已在 3000 端口运行）：
 *   node test/browser-check.js
 *   node test/browser-check.js --base=http://127.0.0.1:3000 --out=./shots
 *
 * playwright 不必装在 server/node_modules 里 —— 脚本会依次在
 * server/node_modules、NODE_PATH、以及本机 WorkBuddy 的共享 node 工作区里找，
 * 找到哪个用哪个。找不到会给出装哪一句。
 */

const fs = require('fs');
const path = require('path');

// 先加载 .env：不传 --admin-pass 时要用里面的 ADMIN_INIT_PASSWORD 兜底，
// 这样 `npm run browser` 可以直接跑（密码不必写进 package.json）
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

/**
 * 找 playwright。
 *
 * 为什么不用裸 require('playwright')：这台机器上 playwright 装在 WorkBuddy 的
 * 共享 node 工作区（不在本项目的 node_modules 里），裸 require 会直接
 * MODULE_NOT_FOUND，报错信息看起来像"脚本坏了"，其实只是路径没对上。
 * 顺手把浏览器内核也一起定位 —— 本机装了 Chrome 就用本机的，
 * 省掉下载 Chromium 那几百兆（这台机器从 storage.googleapis.com 下载会超时）。
 */
function loadPlaywright() {
  const candidates = [
    'playwright',
    path.join(__dirname, '..', 'node_modules', 'playwright'),
    process.env.PLAYWRIGHT_HOME
      ? path.join(process.env.PLAYWRIGHT_HOME, 'node_modules', 'playwright')
      : null,
    'C:/Users/liwei/.workbuddy/binaries/node/workspace/node_modules/playwright',
  ].filter(Boolean);

  for (const c of candidates) {
    try { return require(c); } catch (e) { /* 换下一个 */ }
  }
  console.error('\n找不到 playwright。装一个即可（不用下浏览器内核，用本机 Chrome）：');
  console.error('  npm i -D playwright\n');
  process.exit(3);
}

const { chromium } = loadPlaywright();

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};

const BASE = arg('base', 'http://127.0.0.1:3000').replace(/\/+$/, '');
const OUT = path.resolve(arg('out', path.join(__dirname, '..', 'shots')));
const ADMIN_USER = arg('admin-user', process.env.ADMIN_INIT_USER || 'admin');
const ADMIN_PASS = arg('admin-pass', process.env.ADMIN_INIT_PASSWORD || 'admin123456');

let pass = 0;
let fail = 0;
const problems = [];
const consoleErrors = [];

function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else {
    fail += 1;
    problems.push(name + (extra ? ' → ' + JSON.stringify(extra).slice(0, 200) : ''));
    console.log(`  ✗ ${name}${extra ? '  → ' + JSON.stringify(extra).slice(0, 200) : ''}`);
  }
}

/** 一个最小的合法 JPEG，用于真实走一遍上传 */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHD8Q' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const coverPath = path.join(OUT, 'upload-test.jpg');
  fs.writeFileSync(coverPath, TINY_JPEG);

  console.log('\n清城少年志 · 浏览器端验收');
  console.log(`  目标 ${BASE}\n  截图 ${OUT}\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  // 手机视口：家长几乎都是在微信里的手机屏幕上用
  const WX_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003133) NetType/WIFI Language/zh_CN';
  const mobileOpts = {
    viewport: { width: 430, height: 1600 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: WX_UA,
  };
  const mobile = await browser.newContext(mobileOpts);
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });

  mobile.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('[手机] ' + m.text()); });
  desktop.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('[后台] ' + m.text()); });

  const page = await mobile.newPage();

  /**
   * 4xx/5xx 的监听必须挂到**每一个页面**上，不能只挂在手机端那个 page 上。
   *
   * 踩过的坑：原先只在 `page`（手机端）上挂 response 监听，结果后台（桌面端 `ap`）
   * 发出去的静态资源 404 完全没人管 —— 服务端日志里明明白白有
   * `GET /assets/Home-BD9KoKha.css 404`，断言却是"没有 4xx/5xx 请求"，全绿。
   * 那种 404 正是"发版后旧 hash 资源被删、浏览器还在用缓存的旧 index.html"的信号，
   * 属于必须在验收里抓到的问题。
   *
   * 用 context.on('page') 兜住后续新开的标签页，不依赖"记得给每个 page 补一句"。
   */
  const failedRequests = [];
  const watchPage = (p) => {
    p.on('response', (r) => {
      if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().replace(BASE, '')}`);
    });
  };
  for (const ctx0 of [mobile, desktop]) {
    ctx0.on('page', watchPage);
    for (const p of ctx0.pages()) watchPage(p);
  }
  watchPage(page);

  // ------------------------------------------------------------ 1. 活动说明
  console.log('[1] 活动说明页（/)');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const h1 = (await page.locator('h1').first().textContent().catch(() => '')) || '';
  ok('首屏渲染出主标题', h1.length > 4, { h1: h1.slice(0, 40) });
  ok('出现演练模式横幅（服务端已开模拟日期）', await page.locator('.o-simbar').count() > 0);
  const startBtn = page.locator('a[href="/checkin"], a[href="/register"]').first();
  ok('有进入打卡的按钮', await startBtn.count() > 0);
  await shot(page, '01-home');

  // 说明页应该能看到 7 个主题名
  const bodyText = await page.locator('body').innerText();
  const themeHits = ['专注', '乐观', '希望', '自信', '感恩', '坚韧', '活力'].filter((t) => bodyText.includes(t));
  ok('活动说明里覆盖 7 个主题', themeHits.length === 7, { themeHits });

  // ------------------------------------------------------------ 2. 登记
  console.log('\n[2] 登记页（/register）');
  await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await shot(page, '02-register');

  const CN = '甲乙丙丁戊己庚辛子涵梓萱';
  const rnd = (n) => Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, n || 3);
  // 姓名必须唯一，否则会和上一次跑测试留下的记录撞名，
  // 触发「发现有同名的孩子」弹窗（这是正常功能），导致本步骤被判失败。
  const name = `验收${CN[Math.floor(Math.random() * CN.length)]}${rnd(3)}`;
  const phone = '199' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0');

  const inputs = page.locator('input');
  const inputCount = await inputs.count();
  ok('登记页至少有 3 个输入框（姓名/学校/联系方式）', inputCount >= 3, { inputCount });

  // 按 placeholder / label 找到对应输入框依次填写
  async function fillBy(re, value) {
    const cand = page.locator('input');
    const n = await cand.count();
    for (let i = 0; i < n; i += 1) {
      const el = cand.nth(i);
      const ph = (await el.getAttribute('placeholder')) || '';
      const nm = (await el.getAttribute('name')) || '';
      if (re.test(ph) || re.test(nm)) { await el.fill(value); return true; }
    }
    return false;
  }
  const f1 = await fillBy(/姓名|name/i, name);
  const f2 = await fillBy(/学校|年级|班级|school/i, '验收测试学校 五年级1班');
  const f3 = await fillBy(/手机|联系|电话|phone/i, phone);
  ok('三个字段都定位到了', f1 && f2 && f3, { f1, f2, f3 });

  await page.locator('form button[type="submit"]').first().click();
  await page.waitForTimeout(2800);

  // 万一撞名（随机名或历史数据），会弹「发现有同名的孩子」——这是设计行为，
  // 点「确认无误，去打卡」放行即可，不要把它当成失败。
  const dupModal = page.locator('.o-modal:has-text("发现有同名的孩子")');
  if (await dupModal.count()) {
    ok('（撞名了）重名确认弹窗可正常放行', true);
    await dupModal.locator('button:has-text("确认无误")').first().click();
    await page.waitForTimeout(1200);
  }

  const afterRegUrl = page.url();
  ok('登记成功并进入打卡页', afterRegUrl.includes('/checkin'), { url: afterRegUrl.replace(BASE, '') });
  await shot(page, '03-after-register');

  // ★ 关键回归：登记后刷新页面必须还是登录态。
  // 之前这里挂过 —— 判据用了「state.me 已加载」而不是「本地有 token」，
  // 刷新后 state.me 是 null，页面直接判定没登记、连请求都不发，
  // 家长第二天打开就被要求重新登记。
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const afterReload = await page.locator('body').innerText();
  ok('★ 刷新后仍保持登录态（已登记者直接进打卡视图，不再要求填信息）',
    !/先填一次信息/.test(afterReload) && /今天还没打卡|今天想做哪几件/.test(afterReload),
    { tail: afterReload.slice(0, 200) });
  const stillHasToken = await page.evaluate(() => !!localStorage.getItem('daka.p.token'));
  ok('token 已写入 localStorage（关掉页面再打开也还在）', stillHasToken);
  await shot(page, '03b-after-reload');

  // ------------------------------------------------------------ 2b. 重名流程
  // 活动方明确提过「1000 人要考虑重名」。这里专门验证一次：
  // 同名 + 不同手机号 → 必须建独立记录，并且提示家长自检，而不是拦死或覆盖。
  console.log('\n[2b] 重名处理');
  const ctx2 = await browser.newContext(mobileOpts);
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/register', { waitUntil: 'networkidle' });
  await p2.waitForTimeout(400);
  await p2.locator('#f-name').fill(name);                       // 同上一个人的名字
  await p2.locator('#f-school').fill('另一所学校 六年级2班');    // 不同学校
  await p2.locator('#f-phone').fill('198' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0'));
  await p2.locator('form button[type="submit"]').first().click();
  await p2.waitForTimeout(2500);
  await shot(p2, '03c-same-name');

  const dupText = await p2.locator('.o-modal').allInnerTexts().catch(() => []);
  ok('同名不同人时弹出重名提醒', /发现有同名的孩子/.test(dupText.join(' ')), { dupText: dupText.slice(0, 1) });
  ok('重名提醒里列出了同名人数', new RegExp(`有\\s*\\d+\\s*位同样叫|\\d+\\s*位同样叫`).test(dupText.join(' '))
    || /系统里有/.test(dupText.join(' ')), {});
  const dupBtn = p2.locator('.o-modal button:has-text("确认无误")');
  if (await dupBtn.count()) {
    await dupBtn.first().click();
    await p2.waitForTimeout(1200);
  }
  ok('确认后仍能正常进入打卡页（不会被重名卡住）', p2.url().includes('/checkin'),
    { url: p2.url().replace(BASE, '') });
  await ctx2.close();

  // ------------------------------------------------------------ 2c. 未登记者进打卡页就地填表
  // 要求 #4：打开链接直接到打卡页，没填过信息的孩子在打卡页里就地填那三项，
  // 填过一次的（本地有 token）则不再出现。这里验「没填过」这一侧。
  console.log('\n[2c] 未登记者访问 /checkin 就地出现登记表单');
  const ctx3 = await browser.newContext(mobileOpts);
  watchPage(ctx3);
  const p3 = await ctx3.newPage();
  watchPage(p3);
  await p3.goto(BASE + '/checkin', { waitUntil: 'networkidle' });
  await p3.waitForTimeout(1200);
  await shot(p3, '02c-checkin-need-register');
  const unregText = await p3.locator('body').innerText();
  ok('未登记者打卡页出现「先填一次信息」就地登记入口',
    /先填一次信息/.test(unregText), { tail: unregText.slice(0, 120) });
  const unregInputs = await p3.locator('input').count();
  ok('就地表单含三项输入框（姓名/学校/联系方式）', unregInputs >= 3, { unregInputs });
  await ctx3.close();

  // ------------------------------------------------------------ 3. 打卡页
  console.log('\n[3] 打卡页（/checkin）');
  await page.goto(BASE + '/checkin', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await shot(page, '04-checkin');

  const checkinText = await page.locator('body').innerText();
  ok('打卡页显示今日日期', /\d{4}-\d{2}-\d{2}/.test(checkinText));
  const cards = page.locator('[class*="card"], [class*="task"]');
  ok('打卡页渲染出任务卡', await cards.count() >= 3, { cards: await cards.count() });
  ok('打卡页出现 7 个主题', ['专注', '乐观', '希望', '自信', '感恩', '坚韧', '活力']
    .filter((t) => checkinText.includes(t)).length === 7);
  ok('打卡页显示今日进度', /已覆盖|今日|0\s*\/\s*7|\/\s*7/.test(checkinText), { tail: checkinText.slice(0, 200) });

  // 勾第一个任务
  const firstCheck = page.locator('input[type="checkbox"], .o-pick, [class*="task"] [class*="check"]').first();
  if (await firstCheck.count()) {
    await firstCheck.click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
  }
  const afterPick = await page.locator('body').innerText();
  ok('勾选任务后出现上传区或提交按钮',
    /上传|照片|凭证|提交打卡/.test(afterPick), {});
  await shot(page, '05-checkin-picked');

  // 真实上传一张照片
  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count()) {
    await fileInput.setInputFiles(coverPath);
    await page.waitForTimeout(2500);
    await shot(page, '06-checkin-uploaded');
    const upText = await page.locator('body').innerText();
    ok('上传后界面有已上传反馈', /已上传|上传成功|张|1\s*\/|删除|预览/.test(upText) || (await page.locator('img').count()) > 0);
  } else {
    ok('打卡页存在文件选择入口', false, '找不到 input[type=file]');
  }

  // 提交
  // 注意：不要用 button:has-text("提交") —— 任务卡里那个「已加入本次提交」的
  // 取消勾选按钮也含「提交」两个字，按 DOM 顺序会先命中它，一点就把选中项取消了。
  // 提交按钮只可能是吸底条里的那个。
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  const submit = page.locator('.o-stickybar button.o-btn--primary, #answer-submit-btn').first();
  const selectedText = await page.locator('.o-stickybar').innerText().catch(() => '');
  ok('提交前吸底条显示已选中项', /已选\s*[1-9]/.test(selectedText), { selectedText });
  let submitted = false;
  if (await submit.count()) {
    await submit.scrollIntoViewIfNeeded().catch(() => {});
    // 记录提交请求是否真的发出去了 —— 只看截图会误判成"没反应"
    const reqPromise = page.waitForRequest((r) => r.url().includes('/api/checkin') && r.method() === 'POST',
      { timeout: 15000 }).catch(() => null);
    await submit.click({ force: true }).catch(() => {});
    const req = await reqPromise;
    submitted = !!req;
    ok('提交动作真的发出了 POST /api/checkin', submitted);
    await page.waitForTimeout(2500);
    // 结果用弹窗/toast 呈现，body 末尾未必抓得到，两边都看
    const modalText = await page.locator('.o-modal, .o-toast').allInnerTexts().catch(() => []);
    const doneText = await page.locator('body').innerText();
    ok('提交后页面给出明确结果（成功或说明为什么没算上）',
      /成功|已记|完成|已经打过|忘了传照片|请/.test(doneText) || /成功|已记|完成|已经打过/.test(modalText.join(' ')),
      { modal: modalText.slice(0, 2) });
  } else {
    ok('打卡页有提交按钮', false);
  }
  await shot(page, '07-checkin-submitted');

  // ------------------------------------------------------------ 4. 我的记录
  console.log('\n[4] 我的记录（/records）');
  await page.goto(BASE + '/records', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await shot(page, '08-records');
  const recText = await page.locator('body').innerText();
  ok('记录页能打开且不是空白', recText.trim().length > 40);
  ok('记录页显示累计次数或进度', /累计|次数|项|主题/.test(recText));
  if (submitted) {
    ok('记录页出现刚提交的内容', /2026-10-0\d/.test(recText), { tail: recText.slice(0, 200) });
  }

  // ------------------------------------------------------------ 5. 照片墙
  console.log('\n[5] 清城少年立志瞬间（照片墙）');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await shot(page, '09-gallery');
  const home2 = await page.locator('body').innerText();
  ok('首页出现「清城少年立志瞬间」照片墙区块',
    /清城少年立志瞬间/.test(home2), { tail: home2.slice(0, 120) });
  // 接口 403（后台关掉 gallery_public）时整块会消失；这里至少确认它正常渲染出来了
  ok('照片墙区块渲染出说明文案（含空态占位）',
    /MOMENTS|孩子们交上来的打卡照片|还没有照片/.test(home2));
  // 旧的「打卡战报」入口必须彻底移除，不能还挂在导航或页面里
  ok('旧的「打卡战报」板块已移除（页面不再含该文案）',
    !/打卡战报/.test(home2), { hit: (home2.match(/打卡战报/) || [''])[0] });

  // ------------------------------------------------------------ 6. 后台
  console.log('\n[6] 统计后台（/admin）');
  const ap = await desktop.newPage();
  const adminFailed = [];
  ap.on('response', (r) => {
    if (r.status() >= 400) adminFailed.push(`${r.status()} ${r.url().replace(BASE, '')}`);
  });

  await ap.goto(BASE + '/admin', { waitUntil: 'networkidle' });
  await ap.waitForTimeout(800);
  await shot(ap, '10-admin-login');
  const loginText = await ap.locator('body').innerText();
  ok('未登录访问 /admin 被引导到登录页', /登录|密码/.test(loginText), { tail: loginText.slice(0, 120) });

  // 填账号密码
  const aInputs = ap.locator('input');
  if (await aInputs.count() >= 2) {
    await aInputs.nth(0).fill(ADMIN_USER);
    await aInputs.nth(1).fill(ADMIN_PASS);
    await ap.locator('button[type="submit"], button:has-text("登录")').first().click();
    await ap.waitForTimeout(3000);
  }
  await shot(ap, '11-admin-dashboard');
  const dashText = await ap.locator('body').innerText();
  ok('登录后进入总览', /总览|累计|打卡/.test(dashText));
  ok('总览显示累计打卡次数', /累计.*\d/.test(dashText) || /\d{3,}/.test(dashText));
  ok('总览有当日最多/最少项目', /最多|最少|最热|最冷/.test(dashText), { tail: dashText.slice(0, 200) });
  ok('后台能看到演练模式横幅', await ap.locator('.pp-simbar').count() > 0);
  // 同上：这套皮肤的趋势/矩阵/分布都是 CSS 柱条而非 svg
  const adminCharts = await ap.locator('svg, canvas, [class*="bar"], [class*="matrix"], [class*="trend"]').count();
  ok('总览有图形化统计（趋势/矩阵/分布）', adminCharts >= 3, { adminCharts });

  // ★ 图表已升级为 ECharts：必须真的画在 <canvas> 上，不能只是占个位。
  // Dashboard 共 10 个 PPChart（漏斗/荣誉/趋势/时段/热力图/七主题/学校/当天七项/天数分布/覆盖），
  // 演示数据充足时全部应渲染，断言 >=8 留一点余量（个别图在空态下不画系列）。
  const dashCanvas = await ap.locator('.ant-card canvas').count();
  ok('★ 总览页渲染出 ECharts 画布（图表真的画出来了）', dashCanvas >= 8, { dashCanvas });
  const canvasOk = await ap.evaluate(() => {
    const cs = Array.from(document.querySelectorAll('.pp-chartcard canvas'));
    return cs.length > 0 && cs.every((c) => c.width > 0 && c.height > 0);
  });
  ok('★ 画布有真实像素尺寸（不是空壳 / echarts 没加载）', canvasOk);

  // 逐个后台页面点一遍
  const adminPages = [
    ['/admin/checkins', '打卡明细', /主题|日期|明细/],
    ['/admin/participants', '参与者', /姓名|学校|累计/],
    ['/admin/honors', '荣誉名单', /全能少年|打卡达人|主题之星/],
    ['/admin/media', '附件与空间', /空间|附件|清理|MB/],
    ['/admin/tasks', '任务字典', /专注|乐观|希望/],
    ['/admin/settings', '活动设置', /保存|标题|上限/],
  ];
  const tablePages = ['/admin/checkins', '/admin/participants', '/admin/honors', '/admin/settings', '/admin/tasks'];
  for (const [p, label, re] of adminPages) {
    await ap.goto(BASE + p, { waitUntil: 'networkidle' });
    await ap.waitForTimeout(1400);
    const t = await ap.locator('body').innerText();
    ok(`后台「${label}」页正常渲染`, re.test(t), { tail: t.slice(0, 140) });

    // ★ 表格页必须真的挂载了 ant-design-vue 表格（不是手搓的 .pp-table）。
    // a-v 的 Table 渲染出 .ant-table 容器；空数据也会渲染（带 .ant-empty），
    // 所以只要容器在就说明组件接上了。
    if (tablePages.includes(p)) {
      const antTables = await ap.locator('.ant-table').count();
      ok(`★ 后台「${label}」页使用 ant-design-vue 表格`, antTables > 0, { antTables });
    }
    // 附件页：翻页器必须换成 a-v 的 Pagination
    if (p === '/admin/media') {
      const pagers = await ap.locator('.ant-pagination').count();
      ok('★ 后台「附件」页使用 a-v 分页器', pagers > 0, { pagers });
    }
    await shot(ap, `12-admin-${p.split('/').pop()}`);
  }

  // 导出真实下载一次，确认不是只返回了个 200
  await ap.goto(BASE + '/admin/checkins', { waitUntil: 'networkidle' });
  await ap.waitForTimeout(1200);
  const exportBtn = ap.locator('button:has-text("导出")').first();
  ok('打卡明细页有导出按钮', await exportBtn.count() > 0);
  let download = null;
  if (await exportBtn.count()) {
    // 注意：waitForEvent 必须先把 promise 建好、再触发动作、最后 await。
    // 反过来写（先 await 再点）会先空等一整个超时，然后什么都没等到。
    const dlPromise = ap.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    await exportBtn.click().catch(() => {});
    download = await dlPromise;
  }
  ok('后台导出按钮触发了文件下载', !!download, download ? { name: download.suggestedFilename() } : null);
  if (download) {
    const p = await download.path();
    if (p) {
      const buf = fs.readFileSync(p);
      const head = buf.slice(0, 3);
      ok('下载的 CSV 带 UTF-8 BOM', head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf,
        { head: head.toString('hex') });
      ok('下载的 CSV 有实际内容（>1KB）', buf.length > 1024, { bytes: buf.length });
    }
  }

  // ------------------------------------------- 6b. 关掉视频后前端要真的收起来
  /**
   * 活动方最终可能决定"不收视频"（省七牛存储，见交付说明第七节）。
   * 实现方式是后台把「每项最多视频数」设成 0 —— 这是个不用改代码的开关，
   * 但文档里只是"声称"前端会跟着收起来，从没在浏览器里验过。
   * 这里补上：改了设置 → 打卡页不出现视频区、首页文案不再提"0 段视频"→ 改回去。
   *
   * 用页面自己的 fetch 打接口（token 从 localStorage 取），不再多登一次录 ——
   * 登录接口有 10 次/10 分钟限流，能省一次是一次。
   */
  console.log('\n[6b] 关掉视频：前端要跟着收起来');
  const adminFetch = (pathname, init) => ap.evaluate(async ({ p, i }) => {
    const token = localStorage.getItem('daka.a.token') || '';
    const r = await fetch(p, {
      method: (i && i.method) || 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: i && i.body ? JSON.stringify(i.body) : undefined,
    });
    return { status: r.status, text: await r.text() };
  }, { p: pathname, i: init });

  const actBefore = JSON.parse((await (await fetch(BASE + '/api/activity')).text()));
  const vCountBefore = actBefore.data.limits.videoMaxCount;

  try {
    await adminFetch('/api/admin/settings', {
      method: 'PUT', body: { values: { video_max_count: '0' } },
    });

    const actOff = JSON.parse(await (await fetch(BASE + '/api/activity')).text());
    ok('★ 关掉视频后活动接口的上限变成 0', actOff.data.limits.videoMaxCount === 0,
      { got: actOff.data.limits.videoMaxCount });

    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const homeOff = await page.locator('body').innerText();
    ok('★ 首页不再写「0 段视频」这种像坏了的文案',
      !/0\s*段视频/.test(homeOff) && /不需要上传视频|不收视频/.test(homeOff),
      { hit: (homeOff.match(/[^\n]{0,40}视频[^\n]{0,40}/) || [''])[0] });
    ok('★ 首页三步说明也不再提「视频可传可不传」',
      !/视频可传可不传/.test(homeOff));
    await shot(page, '09b-home-no-video');

    await page.goto(BASE + '/checkin', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const ckOff = await page.locator('body').innerText();
    await shot(page, '09c-checkin-no-video');
    ok('★ 打卡页不再出现视频上传区', !/上传视频|上传一段视频|视频（选填）/.test(ckOff),
      { hit: (ckOff.match(/[^\n]{0,40}视频[^\n]{0,40}/) || [''])[0] });
  } finally {
    // 无论上面成没成，都要把设置改回去 —— 验收脚本不能污染交付状态
    await adminFetch('/api/admin/settings', {
      method: 'PUT', body: { values: { video_max_count: String(vCountBefore) } },
    });
  }
  const actRestored = JSON.parse(await (await fetch(BASE + '/api/activity')).text());
  ok('★ 视频上限已改回原值（验收不留副作用）',
    actRestored.data.limits.videoMaxCount === vCountBefore,
    { want: vCountBefore, got: actRestored.data.limits.videoMaxCount });

  // ------------------------------------------------------------ 7. 控制台与网络
  console.log('\n[7] 控制台与网络');

  /**
   * ★ 缓存头：发版后白屏的根治办法。
   *
   * Vite 产物文件名带 hash，发一次新版旧 hash 的文件就没了。浏览器若缓存了
   * index.html，就会拿旧的去请求已删除的 js/css → 404 → 白屏。
   * 所以：入口 HTML 必须不缓存，带 hash 的资源才长缓存。
   */
  const idxRes = await fetch(BASE + '/', { cache: 'no-store' });
  const idxHtml = await idxRes.text();
  const idxCC = idxRes.headers.get('cache-control') || '';
  ok('★ 入口 HTML 不发缓存（否则发版后可能白屏）',
    /no-store|no-cache/i.test(idxCC),
    { cacheControl: idxCC });

  const assetPath = (idxHtml.match(/\/assets\/[A-Za-z0-9_.-]+\.js/) || [])[0];
  ok('首页确实引用了带 hash 的静态资源（否则上面那条断言没意义）', !!assetPath, { assetPath });
  if (assetPath) {
    const aRes = await fetch(BASE + assetPath);
    const aCC = aRes.headers.get('cache-control') || '';
    ok('★ 带 hash 的静态资源长缓存（内容变了文件名就变，缓存是安全的）',
      /immutable|max-age=\d{5,}/i.test(aCC),
      { asset: assetPath, cacheControl: aCC });
  }

  /**
   * 控制台里的「Failed to load resource ... 404」不带 URL，没法判断是哪个资源，
   * 而下一项检查（failedRequests）已经带 URL 覆盖了同一件事。
   * 所以这里只保留真正的 JS 报错，避免同一问题被算两次、却又定位不到。
   */
  const realErrors = consoleErrors.filter((e) => !/favicon|Vue Devtools|Failed to load resource/i.test(e));
  ok('没有前端 JS 报错', realErrors.length === 0, realErrors.slice(0, 3));

  const realFailed = [...failedRequests, ...adminFailed].filter((u) => !/favicon/i.test(u));
  ok('没有 4xx/5xx 请求', realFailed.length === 0, realFailed.slice(0, 5));

  await browser.close();

  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) {
    console.log('失败明细：');
    problems.forEach((x) => console.log('  - ' + x));
  }
  console.log(`截图目录：${OUT}\n`);
}

main()
  .then(() => process.exit(fail ? 1 : 0))
  .catch((e) => {
    console.error('\n验收中断：' + (e.stack || e.message) + '\n');
    process.exit(2);
  });
