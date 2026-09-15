/**
 * 定点调试：为什么「提交打卡」没发出 POST /api/checkin
 * 用法：NODE_PATH=... node test/debug-submit.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

/** 造一张真实可解码的 JPEG（用 canvas 生成不了，直接写一个最小合法 JPEG 字节流） */
function makeJpeg() {
  // 2x2 白色 JPEG（真实可解码，避免"文件是空的/无法解码"类误判）
  const b64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';
  return Buffer.from(b64, 'base64');
}

(async () => {
  const jpg = path.join(OUT, 'debug-photo.jpg');
  fs.writeFileSync(jpg, makeJpeg());
  console.log('测试照片大小：', fs.statSync(jpg).size, 'bytes');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 1600 } });
  const page = await ctx.newPage();

  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  [console.${m.type()}] ${m.text()}`);
  });
  page.on('request', (r) => {
    if (r.method() !== 'GET') console.log(`  → ${r.method()} ${r.url().replace(BASE, '')}`);
  });
  page.on('response', (r) => {
    const u = r.url().replace(BASE, '');
    if (r.status() >= 400) console.log(`  ← ${r.status()} ${u}`);
  });

  // ---- 登记 ----
  const phone = '19' + String(Date.now()).slice(-9);
  console.log('\n[1] 登记');
  await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
  const inputs = page.locator('input:not([type=file]):not([type=radio]):not([type=checkbox])');
  const n = await inputs.count();
  console.log('  输入框数量', n);
  await inputs.nth(0).fill('调试甲同学');
  await inputs.nth(1).fill('调试小学 五年级1班');
  // 第 3 个可能是联系方式，逐个看 placeholder
  for (let i = 2; i < n; i += 1) {
    const ph = await inputs.nth(i).getAttribute('placeholder');
    console.log(`  input[${i}] placeholder=${ph}`);
    if (ph && /手机|联系|电话/.test(ph)) { await inputs.nth(i).fill(phone); break; }
  }
  await page.locator('button[type="submit"], button:has-text("登记")').first().click();
  await page.waitForTimeout(2000);
  console.log('  当前地址', page.url().replace(BASE, ''));

  // ---- 打卡页 ----
  console.log('\n[2] 打卡页');
  await page.goto(BASE + '/checkin', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const firstSelect = page.locator('button:has-text("选这一项")').first();
  console.log('  「选这一项」按钮数', await page.locator('button:has-text("选这一项")').count());
  await firstSelect.click();
  await page.waitForTimeout(600);

  const fileInput = page.locator('input[type="file"]').first();
  console.log('  file input 数', await page.locator('input[type="file"]').count());
  await fileInput.setInputFiles(jpg);
  console.log('  已投喂文件，等待上传…');
  await page.waitForTimeout(4000);

  // 看上传状态与按钮状态
  const dump = await page.evaluate(() => {
    const text = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => e.innerText.trim()).filter(Boolean);
    const btns = Array.from(document.querySelectorAll('button')).map((b) => ({
      t: b.innerText.trim().replace(/\s+/g, ' ').slice(0, 24),
      disabled: b.disabled,
      cls: b.className.slice(0, 40),
    }));
    return {
      bodyTail: document.body.innerText.slice(-400),
      toasts: text('.o-toast'),
      badges: text('[class*=badge]'),
      btns: btns.filter((b) => /提交|选这一项|已加入/.test(b.t)),
      thumbCount: document.querySelectorAll('.o-thumb').length,
      uploaderVisible: document.querySelectorAll('.uploader').length,
    };
  });
  console.log('\n  上传后状态：');
  console.log('    缩略图数量', dump.thumbCount, '| 上传区', dump.uploaderVisible);
  console.log('    相关按钮', JSON.stringify(dump.btns, null, 1));
  console.log('    toast', JSON.stringify(dump.toasts));

  // ---- 提交 ----
  console.log('\n[3] 点提交');
  const submitAll = page.locator('#answer-submit-btn, button:has-text("提交")');
  const cnt = await submitAll.count();
  console.log('  匹配到的提交类按钮数', cnt);
  for (let i = 0; i < cnt; i += 1) {
    const el = submitAll.nth(i);
    console.log(`    [${i}] text="${(await el.innerText()).trim().replace(/\s+/g, ' ')}" disabled=${await el.isDisabled().catch(() => '?')}`);
  }
  const submit = submitAll.first();

  let fired = null;
  page.on('request', (r) => { if (r.url().includes('/api/checkin') && r.method() === 'POST') fired = r.url(); });

  await submit.scrollIntoViewIfNeeded().catch(() => {});
  await submit.click();
  await page.waitForTimeout(500);
  const t1 = await page.evaluate(() => Array.from(document.querySelectorAll('.o-toast,.o-modal,.o-modal__box')).map((e) => e.innerText.trim().slice(0, 200)));
  console.log('  点击后 500ms 的提示/弹窗：', JSON.stringify(t1));
  await page.waitForTimeout(3000);
  console.log('  POST /api/checkin 是否发出：', fired ? '是 → ' + fired.replace(BASE, '') : '否');
  const after = await page.evaluate(() => ({
    toasts: Array.from(document.querySelectorAll('.o-toast')).map((e) => e.innerText.trim()),
    modal: Array.from(document.querySelectorAll('.o-modal')).map((e) => e.innerText.trim().slice(0, 300)),
    tail: document.body.innerText.slice(-300),
  }));
  console.log('  3.5s 后：toast=', JSON.stringify(after.toasts));
  console.log('            modal=', JSON.stringify(after.modal));

  await page.screenshot({ path: path.join(OUT, 'debug-submit.png'), fullPage: true });
  console.log('\n截图：shots/debug-submit.png');

  await browser.close();
})();
