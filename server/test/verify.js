#!/usr/bin/env node
/**
 * 一条命令跑完四套验收，最后给一张汇总表。
 *
 * 为什么不直接在 package.json 里用 `&&` 串起来（原来就是那样）：
 *   `/api/admin/login` 有 10 次/10 分钟限流（正确的安全设计，不能为测试放宽）。
 *   用 `&&` 时，只要某一套撞上 429 退出了，**后面几套一套都不会跑** ——
 *   你只能等 10 分钟从头再来，而那一轮里明明还有能验的东西。
 *   这个脚本改成「逐套跑、限流的跳过、跑完汇总」，让一轮里能验的都验掉。
 *
 * 退出码语义（和单套脚本一致）：
 *   0  全部通过
 *   1  有断言失败（真问题）
 *   2  某套脚本崩了（环境/脚本自身问题）
 *   3  有套次被限流跳过，没验全 —— 不是失败
 *
 * 用法：
 *   node test/verify.js
 *   node test/verify.js --admin-pass=xxxxxx      # 透传给每一套
 */

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SUITES = [
  { file: 'smoke.js', name: '接口验收', what: '业务规则（去重/必填/权限/幂等）' },
  { file: 'stats-audit.js', name: '统计口径对账', what: '数字对不对（原生 SQL 交叉核对）' },
  { file: 'browser-check.js', name: '浏览器端到端', what: '真 Chrome 走完整流程' },
  { file: 'extra-check.js', name: '后台链路补测', what: '边角按钮（导出/清理/设置/改密码/媒体直链）' },
];

const passthrough = process.argv.slice(2);

function runSuite(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, file), ...passthrough], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    // 边跑边透传，否则四套跑一分多钟、屏幕上一直没东西，会被误以为卡死
    child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
    child.stderr.on('data', (d) => { out += d.toString(); process.stderr.write(d); });
    child.on('error', (e) => resolve({ code: 2, out: out + '\n' + e.message }));
    child.on('close', (code) => resolve({ code: code === null || code === undefined ? 2 : code, out }));
  });
}

/** 从输出里抠出「结果：通过 N 项，失败 M 项」这类结论行 */
function pickConclusion(out) {
  const lines = out.split('\n').map((s) => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/^结果[：:]/.test(lines[i])) return lines[i];
  }
  return '(没打印结论)';
}

/** 有没有明确打出"被限流/跳过"的提示 */
function wasRateLimited(out) {
  return /限流|TOO_MANY_REQUESTS|429/.test(out);
}

(async () => {
  const started = Date.now();
  console.log('=========================================================');
  console.log('清城少年志 · 打卡工具 · 验收总跑');
  console.log(`  组成：${SUITES.length} 套（接口 / 口径 / 浏览器 / 边角）`);
  console.log('=========================================================');

  const results = [];

  for (let i = 0; i < SUITES.length; i += 1) {
    const s = SUITES[i];
    console.log(`\n\n############ ${i + 1}/${SUITES.length} ${s.name}（${s.file}）############`);
    const t = Date.now();
    const r = await runSuite(s.file);
    results.push({
      ...s,
      code: r.code,
      secs: ((Date.now() - t) / 1000).toFixed(1),
      conclusion: pickConclusion(r.out),
      limited: wasRateLimited(r.out),
    });
  }

  // ---------------------------------------------------------- 汇总
  const bad = results.filter((r) => r.code === 1);
  const crashed = results.filter((r) => r.code === 2);
  const skipped = results.filter((r) => r.code === 3);
  const passed = results.filter((r) => r.code === 0);

  console.log('\n\n=========================================================');
  console.log('汇总');
  console.log('=========================================================');
  for (const r of results) {
    const mark = r.code === 0 ? '✅ 通过'
      : r.code === 1 ? '❌ 有失败'
        : r.code === 2 ? '⚠️  中断'
          : '⏭  未验全';
    console.log(`  ${mark}  ${r.name.padEnd(7, '　')} ${String(r.secs).padStart(5)}s  ${r.conclusion}`);
  }
  console.log(`\n  用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);

  if (bad.length) {
    console.log(`\n  ❌ 有断言失败：${bad.map((r) => r.name).join('、')} —— 这是真问题，要修。`);
  }
  if (crashed.length) {
    console.log(`\n  ⚠️  脚本中断：${crashed.map((r) => r.name).join('、')} —— 多为环境问题，看上面的报错。`);
  }
  if (skipped.length) {
    console.log(`\n  ⏭  未验全（不是失败）：${skipped.map((r) => r.name).join('、')}`);
    if (skipped.some((r) => r.limited)) {
      console.log('     登录接口有 10 次/10 分钟的限流。等 10 分钟，');
      console.log('     或重启一次后端服务（计数在内存里）再跑一遍。');
      console.log('     连续多轮回归时，这是最容易撞上的一堵墙。');
    }
  }
  if (passed.length === results.length) {
    console.log('\n  ✅ 四套全通过，这一轮验完了。');
  }
  console.log('');

  // ---------------------------------------------------------- 退出码
  if (bad.length) process.exit(1);
  if (crashed.length) process.exit(2);
  if (skipped.length) process.exit(3);
  process.exit(0);
})();
