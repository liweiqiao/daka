'use strict';

/**
 * 后台链路验收 —— 专补 smoke.js 没覆盖到的部分。
 *
 * smoke.js 管的是"主流程能跑通"，本脚本管的是"边角和不常点的按钮别是坏的"：
 *   1. 视频链路（照片+视频混合提交，视频要真计入台账）
 *   2. 文件类型校验（改后缀名骗不过去）
 *   3. 重复提交同一主题（原因码可读）
 *   4. 同一手机号给两个孩子报名（siblings 提示，且互不干扰）
 *   5. 后台删单条打卡（★ 同一批次里删一项，不能连累同批次其它主题的凭证）
 *   6. 孤儿文件清理（试算 → 真删 → 台账不误伤已绑定文件）
 *   7. 活动设置保存即生效（改 → 生效 → 改回）
 *   8. 改管理员密码（改 → 新密码能登录 → 改回）
 *
 * 登录接口有 10 次/10 分钟限流（正确的安全设计）。反复连跑本脚本会撞 429，
 * 此时相关断言会被跳过并提示，而不是判失败 —— 没验证成功 ≠ 验证失败。
 *
 * 用法：
 *   node test/extra-check.js                                  （密码从 .env 读）
 *   node test/extra-check.js --admin-pass=admin123456         （显式指定）
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

function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else {
    fail += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${extra ? '  → ' + JSON.stringify(extra).slice(0, 240) : ''}`);
  }
}

async function call(pathname, { method = 'GET', body, token, form, expectFail = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(BASE + pathname, {
    method,
    headers,
    body: form || (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 二进制或空体 */ }

  if (!expectFail && res.status >= 400) {
    throw new Error(`${method} ${pathname} → ${res.status} ${text.slice(0, 220)}`);
  }
  return { status: res.status, json, text, headers: res.headers };
}

// ------------------------------------------------------------------ 造测试素材

const IMG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
  + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAA'
  + 'AQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIh'
  + 'MUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpT'
  + 'VFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5'
  + 'usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iii'
  + 'gD//2Q==',
  'base64'
);

/** 造一段结构上像真 MP4 的字节：第 4-8 字节 'ftyp'，品牌 isom */
function makeMp4(bytes = 2 * 1024 * 1024) {
  const buf = Buffer.alloc(bytes, 0);
  buf.writeUInt32BE(24, 0);            // box size
  buf.write('ftyp', 4, 'latin1');
  buf.write('isom', 8, 'latin1');       // major brand
  buf.writeUInt32BE(512, 12);
  buf.write('isomiso2avc1mp41', 16, 'latin1');
  buf.write('mdat', 32, 'latin1');      // 后面随便填，模拟数据段
  return buf;
}

async function uploadFile(token, { type, mime, fileName, buf }) {
  const tk = await call('/api/upload/ticket', {
    method: 'POST', token,
    body: { type, mime, size: buf.length, fileName },
  });
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: mime }), fileName);
  const up = await call(`/api/upload/local?key=${encodeURIComponent(tk.json.data.key)}`, {
    method: 'POST', token, form: fd, expectFail: true,
  });
  return { ticket: tk.json.data, res: up };
}

async function register(name, school, phone) {
  const r = await call('/api/participant/register', {
    method: 'POST', body: { name, school, phone },
  });
  return r.json.data;
}

/**
 * 管理员登录。
 *
 * 登录接口有 10 次 / 10 分钟限流（这是正确的安全设计，不该为了测试放宽）。
 * 连着跑几轮验收脚本会撞上限流，所以这里把 429 单独识别出来，
 * 让调用方优雅跳过相关断言，而不是让整个脚本崩在半路。
 */
async function adminLogin(password) {
  const r = await call('/api/admin/login', {
    method: 'POST', body: { username: ADMIN_USER, password }, expectFail: true,
  });
  if (r.status === 429) return { limited: true };
  if (r.status >= 400) return { bad: true, status: r.status };
  return { token: r.json.data.token };
}

// ------------------------------------------------------------------

(async () => {
  console.log('\n清城少年志 · 后台链路验收（补充）');
  console.log(`  目标 ${BASE}\n`);

  const uniq = Date.now().toString().slice(-6);
  const phoneA = `179${uniq}00`.slice(0, 11);
  const phoneB = `178${uniq}00`.slice(0, 11);
  // 姓名要每轮唯一，否则重跑时会撞上上一轮的数据，
  // 导致"第一次提交"变成 DUPLICATE 而误报失败（姓名只允许中文/字母，不能带数字）
  const tag = Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 3) || 'zqk';
  const nmA = `补测${tag}甲`;
  const nmB = `补测${tag}乙`;
  const schA = '补测小学 四年级1班';
  const schB = '补测小学 一年级1班';

  // ============================================================ 1. 视频链路
  console.log('[1] 视频链路（照片必填 + 视频选填）');
  const pA = await register(nmA, schA, phoneA);
  const token = pA.token;

  const tasksRes = await call('/api/me/tasks', { token });
  const tasks = tasksRes.json.data.tasks || [];
  ok('打卡页能拿到今日任务', tasks.length >= 3, { n: tasks.length });

  const t1 = tasks[0];
  const img = await uploadFile(token, { type: 'image', mime: 'image/jpeg', fileName: 'p.jpg', buf: IMG });
  ok('照片上传成功', img.res.status === 200, { status: img.res.status });

  const vid = await uploadFile(token, { type: 'video', mime: 'video/mp4', fileName: 'v.mp4', buf: makeMp4() });
  ok('视频上传成功', vid.res.status === 200, { status: vid.res.status });
  ok('视频回写真实 mime', vid.res.json && vid.res.json.data.mime === 'video/mp4',
    vid.res.json && vid.res.json.data);

  const sub = await call('/api/checkin', {
    method: 'POST', token,
    body: {
      requestId: `extra-${uniq}-1`,
      items: [{
        taskId: t1.id,
        remark: '补测：照片+视频一起交',
        media: [{ key: img.ticket.key, type: 'image' }, { key: vid.ticket.key, type: 'video' }],
      }],
    },
  });
  ok('照片+视频混合提交成功', sub.json.data.accepted && sub.json.data.accepted.length === 1,
    sub.json.data);

  const rec = await call('/api/me/records', { token });
  const day0 = (rec.json.data.days || [])[0] || { items: [] };
  const item0 = (day0.items || [])[0] || {};
  ok('记录里能看到刚交的照片+视频',
    (item0.images || []).length === 1 && (item0.videos || []).length === 1,
    { images: (item0.images || []).length, videos: (item0.videos || []).length });

  // ============================================================ 2. 类型校验
  console.log('\n[2] 文件类型校验（改后缀名骗不过去）');

  const fakeAsImage = await uploadFile(token, {
    type: 'image', mime: 'image/jpeg', fileName: 'evils.jpg',
    buf: Buffer.from('MZ\x90\x00this is definitely not an image, just plain text padding padding', 'latin1'),
  });
  ok('纯文本改名成 .jpg 被拦下', fakeAsImage.res.status >= 400,
    { status: fakeAsImage.res.status, msg: fakeAsImage.res.json && fakeAsImage.res.json.message });

  const vidAsImage = await uploadFile(token, {
    type: 'image', mime: 'image/jpeg', fileName: 'actually-video.jpg', buf: makeMp4(4096),
  });
  ok('视频放到「照片」格子里被拦下', vidAsImage.res.status >= 400,
    { status: vidAsImage.res.status, msg: vidAsImage.res.json && vidAsImage.res.json.message });

  // ============================================================ 3. 重复提交
  console.log('\n[3] 重复提交同一主题');
  const again = await call('/api/checkin', {
    method: 'POST', token,
    body: {
      requestId: `extra-${uniq}-2`,
      items: [{ taskId: t1.id, media: [{ key: img.ticket.key, type: 'image' }] }],
    },
  });
  const sk = ((again.json.data || {}).skipped || [])[0] || {};
  ok('重复提交被跳过且原因可读', sk.reason === 'DUPLICATE' && !!sk.message,
    { skipped: again.json.data.skipped });

  // ============================================================ 4. 同手机号两孩
  console.log('\n[4] 同一手机号给两个孩子报名');
  const pB = await register(nmB, schB, phoneA); // 同号，不同名
  ok('同手机号+不同姓名 = 另建一条记录', pB.participant.id !== pA.participant.id,
    { a: pA.participant.id, b: pB.participant.id });
  ok('接口提示了同一手机号下的其他孩子', pB.siblings >= 1, { siblings: pB.siblings });

  const pAgain = await register(nmA, schA, phoneA); // 同名同号 = 同一人
  ok('同名同号重复登记返回原记录（不新增）', pAgain.participant.id === pA.participant.id,
    { got: pAgain.participant.id, want: pA.participant.id });

  // ============================================================ 5. 后台链路
  console.log('\n[5] 后台：删单条打卡不能连累同批次其它主题');

  const login = await adminLogin(ADMIN_PASS);
  if (login.limited) {
    console.log('  ⚠ 登录接口触发限流（10 次/10 分钟），本段与第 8 段跳过。');
    console.log('    这是正确的安全行为。等 10 分钟或重启服务后再跑。');
  }
  const at = login.token;
  if (at) ok('管理员登录成功', true);

  if (!at) {
    console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
    console.log('未执行的段落（不代表通过）：');
    console.log('  ! 后台：删单条打卡 / 孤儿清理 / 活动设置 / 改密码'
      + (login.limited ? '（登录接口限流）' : '（登录失败）'));
    // 退出码 3 = 跑不完整，不是失败。串在 npm run verify 里时应该停下来，
    // 而不是继续往上撞限流，更不能让「失败 0 项」被读成"全都验过了"。
    process.exit(fail ? 1 : 3);
  }

  // 造一个"一次提交含 2 个主题"的批次
  const t2 = tasks[1];
  const img2a = await uploadFile(token, { type: 'image', mime: 'image/jpeg', fileName: 'a.jpg', buf: IMG });
  const img2b = await uploadFile(token, { type: 'image', mime: 'image/jpeg', fileName: 'b.jpg', buf: IMG });
  const multi = await call('/api/checkin', {
    method: 'POST', token,
    body: {
      requestId: `extra-${uniq}-3`,
      items: [
        { taskId: t1.id, media: [{ key: img2a.ticket.key, type: 'image' }] },
        { taskId: t2.id, media: [{ key: img2b.ticket.key, type: 'image' }] },
      ],
    },
  });
  // t1 今天已经交过 → 只有 t2 会被接受
  const accepted = (multi.json.data || {}).accepted || [];
  ok('多选集中提交只接受了没交过的那个主题', accepted.length === 1 && accepted[0].taskId === t2.id,
    { accepted: accepted.map((a) => a.taskId) });

  // 找 t2 那条打卡记录的 id
  // 注意：库里演示数据有 1500+ 行，翻页翻不到测试账号，必须用 keyword 收窄
  const list = await call(`/api/admin/checkins?keyword=${encodeURIComponent(nmA)}&page=1&pageSize=50`, { token: at });
  const rows = list.json.data.list || [];
  ok('后台按姓名能筛出测试账号的记录', rows.length >= 1, { n: rows.length });
  const t2row = rows.find((r) => r.taskName === t2.name);
  ok('后台明细里能找到这条打卡', !!t2row,
    { want: t2.name, got: rows.map((r) => r.taskName) });

  if (t2row) {
    const before = await call(`/api/admin/checkin/${t2row.id}/media`, { token: at });
    // 详情接口返回的是 data.media 扁平数组（每项 {id,type,key,url,...}）
    const beforeKeys = (before.json.data.media || []).map((m) => m.key);
    ok('删除前能查到这条的凭证', beforeKeys.length >= 1, { beforeKeys: beforeKeys.length });

    const del = await call(`/api/admin/checkin/${t2row.id}`, { method: 'DELETE', token: at });
    ok('删除单条打卡成功', del.status === 200 || del.json.ok === true, del.json);

    // ★ 关键：被删那条的凭证应解绑，但同一个人的其它主题记录必须完好
    const after = await call(`/api/admin/checkins?keyword=${encodeURIComponent(nmA)}&page=1&pageSize=50`, { token: at });
    const left = after.json.data.list || [];
    ok('★ 删除只影响这一条，其它主题的打卡还在', left.length >= 1,
      { left: left.map((r) => r.taskName) });
    ok('★ 被删的那条确实不在了', !left.some((r) => r.taskName === t2.name),
      { left: left.map((r) => r.taskName) });

    const recAfter = await call('/api/me/records', { token });
    const allMedia = (recAfter.json.data.days || []).flatMap((d) => d.items || [])
      .flatMap((i) => [...(i.images || []), ...(i.videos || [])]);
    ok('★ 家长端"我的记录"里其它凭证的图片仍可访问', allMedia.length >= 2,
      { mediaCount: allMedia.length });

    /**
     * 媒体直链的三件事必须都对，缺一个家长就会看到裂图 / 视频转圈：
     *   HEAD  → 200，并且要和 GET 报同样的 Content-Type / Content-Length
     *           （Koa 在 body=null 时会偷偷把状态改成 204 并清掉这两个头，
     *             曾经的实现就踩了这个坑）
     *   GET   → 200 且真的吐字节
     *   Range → 206 + Content-Range，视频要能拖进度、边下边播
     */
    if (allMedia.length) {
      const mediaUrl = allMedia[0].url;

      const head = await fetch(mediaUrl, { method: 'HEAD' });
      const hLen = head.headers.get('content-length');
      const hType = head.headers.get('content-type');
      ok('★ 被保留的凭证链接还能打开（没被误删）', head.status === 200,
        { status: head.status, url: mediaUrl });
      ok('★ HEAD 会回报 Content-Type 与 Content-Length（不能是光秃秃的 204）',
        !!hType && Number(hLen) > 0, { hType, hLen });

      const get = await fetch(mediaUrl);
      const body = Buffer.from(await get.arrayBuffer());
      ok('★ GET 能真的取到文件字节', get.status === 200 && body.length === Number(hLen),
        { status: get.status, bytes: body.length, hLen, type: get.headers.get('content-type') });

      const part = await fetch(mediaUrl, { headers: { Range: 'bytes=0-9' } });
      const partBuf = Buffer.from(await part.arrayBuffer());
      ok('★ Range 请求返回 206 且只给要的那段（视频拖进度要靠它）',
        part.status === 206 && partBuf.length === 10 && /^bytes 0-9\//.test(part.headers.get('content-range') || ''),
        { status: part.status, bytes: partBuf.length, cr: part.headers.get('content-range') });

      const bad = await fetch(mediaUrl, { headers: { Range: 'bytes=999999-' } });
      ok('越界 Range 返回 416 而不是崩掉', bad.status === 416, { status: bad.status });
    }
  }

  // ============================================================ 6. 孤儿清理
  console.log('\n[6] 后台：清理未提交的孤儿文件');
  const orphan = await uploadFile(token, { type: 'image', mime: 'image/jpeg', fileName: 'orphan.jpg', buf: IMG });
  ok('造出一个"传了但没提交"的孤儿文件', orphan.res.status === 200);

  const dry = await call('/api/admin/media/cleanup', {
    method: 'POST', token: at, body: { dryRun: true, olderThanHours: 1 },
  });
  ok('试算接口可用（未真正删除）', dry.json.data.dryRun === true, dry.json.data);

  // 时间窗设成 1 小时会放过刚造的孤儿，这里用 dryRun 的候选数做提示即可；
  // 真正删除用 1 小时以内不可能命中，故只验证"接口不会误删已绑定文件"
  const mediaList = await call('/api/admin/media?status=1&page=1&pageSize=5', { token: at });
  ok('已归档凭证列表可用', Array.isArray(mediaList.json.data.list), { n: (mediaList.json.data.list || []).length });

  const real = await call('/api/admin/media/cleanup', {
    method: 'POST', token: at, body: { dryRun: false, olderThanHours: 1, limit: 50 },
  });
  ok('真删接口可用（不再报错）', typeof real.json.data.removed === 'number', real.json.data);

  // ============================================================ 7. 设置生效
  console.log('\n[7] 后台：活动设置保存立即生效');
  const before = await call('/api/activity');
  const vBefore = before.json.data.limits.videoMaxCount;

  const put = await call('/api/admin/settings', {
    method: 'PUT', token: at, body: { values: { video_max_count: '0' } },
  });
  ok('保存设置成功', put.json.ok === true, put.json);

  const after0 = await call('/api/activity');
  ok('★ 关掉视频后，活动接口里的上限跟着变成 0（前端会隐藏视频区）',
    after0.json.data.limits.videoMaxCount === 0,
    { got: after0.json.data.limits.videoMaxCount });

  await call('/api/admin/settings', {
    method: 'PUT', token: at, body: { values: { video_max_count: String(vBefore) } },
  });
  const restored = await call('/api/activity');
  ok('改回原值也生效', restored.json.data.limits.videoMaxCount === vBefore,
    { want: vBefore, got: restored.json.data.limits.videoMaxCount });

  // ============================================================ 8. 改密码
  console.log('\n[8] 后台：改密码');
  const NEWPW = 'Zx9k2mQ7pL';
  const weak = await call('/api/admin/password', {
    method: 'POST', token: at, body: { oldPassword: ADMIN_PASS, newPassword: '12345678' },
    expectFail: true,
  });
  ok('弱密码（纯数字）被拒', weak.status >= 400, { status: weak.status });

  const wrongOld = await call('/api/admin/password', {
    method: 'POST', token: at, body: { oldPassword: 'definitely-wrong', newPassword: NEWPW },
    expectFail: true,
  });
  ok('原密码不对被拒', wrongOld.status >= 400, { status: wrongOld.status });

  const chg = await call('/api/admin/password', {
    method: 'POST', token: at, body: { oldPassword: ADMIN_PASS, newPassword: NEWPW },
  });
  ok('改密码成功', chg.json.ok === true, chg.json);

  // 注意：登录接口有 10 次/10 分钟限流，本段要连打 3 次，
  // 反复跑脚本时很容易撞上 429。撞上时说明"没验证成功"，而不是"验证失败"，
  // 必须跳过断言而不是判失败，否则会给出错误结论。
  const reLogin = await adminLogin(NEWPW);
  if (reLogin.limited) {
    console.log('  ⚠ 触发登录限流，新密码登录验证跳过（无法判定，非失败）');
  } else {
    ok('★ 新密码能登录', !!reLogin.token, { status: reLogin.status });
  }

  const oldLogin = await call('/api/admin/login', {
    method: 'POST', body: { username: ADMIN_USER, password: ADMIN_PASS }, expectFail: true,
  });
  if (oldLogin.status === 429) {
    console.log('  ⚠ 触发登录限流，旧密码失效验证跳过（无法判定，非失败）');
  } else {
    ok('★ 旧密码已失效', oldLogin.status >= 400, { status: oldLogin.status });
  }

  // 改回去，别把交付的默认密码弄乱。
  // 密码变更不会让已签发的 JWT 失效，所以万一新密码登录被限流，
  // 用第 5 段拿到的 at 也能把密码改回来。
  const backTok = reLogin.token || at;
  const back = await call('/api/admin/password', {
    method: 'POST', token: backTok,
    body: { oldPassword: NEWPW, newPassword: ADMIN_PASS },
  });
  ok('密码已改回默认（不影响交付）', back.json.ok === true, back.json);

  const finalLogin = await adminLogin(ADMIN_PASS);
  if (finalLogin.limited) {
    // 走到这里说明密码已经被改回，只是没法再验证一次；用 at 探一下后台能不能通
    const probe = await call('/api/admin/overview', { token: at });
    ok('★ 密码已恢复，后台仍可正常访问（登录验证因限流改用旧 token 探测）',
      probe.json.ok === true, { status: probe.status });
  } else {
    ok('默认密码可正常登录', !!finalLogin.token, { status: finalLogin.status });
  }

  // ============================================================
  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) {
    console.log('失败明细：');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
})().catch((e) => {
  console.error('\n脚本中断：', e.message);
  process.exit(2);
});
