'use strict';

/**
 * 清城少年志 · 国庆打卡工具 —— 服务入口。
 *
 * 启动顺序有讲究：
 *   1. 先把错误处理装上（后面任何一步炸了都能返回人话）
 *   2. 再挂 CORS（前端是独立域名，没有它浏览器直接拦掉）
 *   3. 然后才是业务路由
 *   4. 最后兜底静态页面 + 前端路由 fallback
 *
 * 数据库连不上时**不退出进程**，而是把 /api/health 标红。
 * 原因：微信里家长可能正在提交，服务贸然退出比重启更糟；
 * 而且这样能在服务器上先把服务跑起来，边查库边看日志。
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const Koa = require('koa');
const cors = require('@koa/cors');
const { koaBody } = require('koa-body');
const serve = require('koa-static');

const config = require('./config');
const db = require('./db');
const time = require('./time');
const { sweepTmp } = require('./fsx');
const { errorHandler } = require('./middleware/error');
const publicRouter = require('./routes/public');
const adminRouter = require('./routes/admin');

const app = new Koa();
app.proxy = true; // 部署在 nginx / 负载均衡后面时，ctx.ip / ctx.protocol 才是真实值

// ------------------------------------------------------------------ 临时上传目录

/**
 * formidable 不会自己创建 uploadDir。
 * 目录不存在时它 `new fs.WriteStream(filepath)` 会异步失败，但 parse 回调
 * 依然返回成功 —— 结果就是上传接口 500、报错信息和「目录不存在」八竿子打不着。
 * 所以必须在收到第一个请求之前把目录建出来。
 */
fs.mkdirSync(config.upload.tmpDir, { recursive: true });

/**
 * 兜底清扫临时残片。
 *
 * 正常情况下上传接口处理完就会把临时文件删掉（fsx.safeUnlink 带重试，
 * 因为 Windows 上 formidable 的写流句柄可能还没放开，一次 unlink 会 EBUSY 失败）。
 * 这里兜的是两种情况：① 重试也失败；② 家长传到一半断网/关页面，进程根本没走到清理。
 * 时间窗取 config.upload.tmpMaxAgeMin（默认 60 分钟），比"正在进行的上传"长得多，
 * 不会误删活着的文件。
 */
async function sweepTmpUploads() {
  try {
    const r = await sweepTmp(config.upload.tmpDir, {
      maxAgeMs: config.upload.tmpMaxAgeMin * 60000,
    });
    if (r.removed) {
      console.log(`  [tmp] 清理临时上传残片 ${r.removed} 个，释放 ${(r.bytes / 1048576).toFixed(1)}MB`);
    }
  } catch (e) { /* 清扫失败不该影响服务 */ }
}

sweepTmpUploads();                                   // 启动时先扫一次
const tmpTimer = setInterval(sweepTmpUploads, 30 * 60000);
tmpTimer.unref();

// ------------------------------------------------------------------ 基础中间件

/**
 * 请求日志：只记必要信息，不记 body（里面有手机号，别落到日志里）。
 *
 * ★ 必须放在 errorHandler 的**外层**（也就是先注册）。
 *   踩过的坑：原先放在 errorHandler 内层，于是任何"抛出来的错"（限流 429、鉴权 401、
 *   参数 400）在日志里都记成 404 —— 因为 async 函数是边抛边展开的，
 *   finally 跑的时候错误还没被 errorHandler 接住，ctx.status 还是 Koa 的默认值 404。
 *   症状是排查限流时看到满屏 `! POST /api/admin/login 404 0ms`，人会往"路由没挂上"去想。
 *   放外层后 errorHandler 不 rethrow，await next() 正常返回，此时 status 已是最终值。
 */
app.use(async (ctx, next) => {
  const start = Date.now();
  let logged = false;
  try {
    await next();
  } catch (e) {
    // 兜底：万一错误越过了 errorHandler（比如 errorHandler 自己也炸了），
    // 这里至少要把真实的失败记下来，不能被 finally 里那句默认 404 盖过去。
    const ms = Date.now() - start;
    console.log(`[${time.nowStr()}] !! ${ctx.method} ${ctx.path} ${ctx.status} ${ms}ms 未捕获:${e.message}`);
    logged = true;
    throw e;
  } finally {
    if (!logged) {
      const ms = Date.now() - start;
      const flag = ctx.status >= 500 ? ' !!' : ctx.status >= 400 ? ' !' : '';
      console.log(`[${time.nowStr()}]${flag} ${ctx.method} ${ctx.path} ${ctx.status} ${ms}ms`);
    }
  }
});

app.use(errorHandler);

app.use(cors({
  origin(ctx) {
    const list = config.cors.origins;
    if (list.includes('*')) return ctx.get('origin') || '*';
    const origin = ctx.get('origin');
    return list.includes(origin) ? origin : '';
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: ['X-Zip-Entries', 'X-Zip-Skipped', 'X-Zip-Truncated'],
  maxAge: 86400,
}));

app.use(koaBody({
  // 上传接口走 multipart，本地驱动下手机拍的视频可能几十 MB，
  // 这个上限必须 >= 视频上限，否则 koa-body 会在业务代码之前就把请求掐掉
  multipart: true,
  jsonLimit: '2mb',
  formLimit: '2mb',
  textLimit: '2mb',
  formidable: {
    maxFileSize: Math.max(config.upload.videoMaxMB, config.upload.photoMaxMB) * 1024 * 1024 + 1024 * 1024,
    uploadDir: config.upload.tmpDir,
    keepExtensions: true,
    multiples: false,
  },
  onError(err, ctx) {
    ctx.throw(400, err.message || '请求格式不正确');
  },
}));

/**
 * 本地驱动的媒体直链：/media/<objectKey> → 上传目录里的文件。
 *
 * 为什么不用 koa-static 直接挂目录：storage/local.js 生成的链接带 /media 前缀，
 * 而 koa-static 只能挂根路径。写个中间件比引入 koa-mount 更透明，
 * 也能顺手把路径穿越挡死（详见 local.resolveForServing），并且自己实现
 * HEAD 与 Range —— 视频要在微信里边下边播，这两样缺一个都会出问题。
 */
if (config.storage.driver === 'local') {
  const local = require('./storage/local');
  local.ensureRoot();

  app.use(async (ctx, next) => {
    if (!ctx.path.startsWith('/media/')) return next();
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return next();

    let key;
    try {
      key = decodeURIComponent(ctx.path.slice('/media/'.length));
    } catch (e) {
      ctx.status = 400;
      ctx.body = 'bad key';
      return;
    }

    const abs = local.resolveForServing(key);
    if (!abs) { ctx.status = 403; ctx.body = 'forbidden'; return; }

    let st;
    try {
      st = await fsp.stat(abs);
    } catch (e) {
      ctx.status = 404;
      ctx.body = 'not found';
      return;
    }
    if (!st.isFile()) { ctx.status = 404; ctx.body = 'not found'; return; }

    ctx.type = path.extname(abs) || 'application/octet-stream';
    ctx.set('Accept-Ranges', 'bytes');
    // 媒体短时间内不会变，缓存一天；避免家长回看记录时反复拉同一张图
    ctx.set('Cache-Control', 'private, max-age=86400');

    /**
     * HEAD 只回报元信息，不回正文。
     *
     * 顺序不能颠倒：Koa 在 `body = null` 时会把状态改写成 204，并
     * 顺手删掉 Content-Type / Content-Length —— 实测 HEAD 会变成光秃秃的
     * 「204 No Content」，跟 GET 的头完全对不上。链接检测工具、微信预览
     * 抓取遇到这种响应会当成空文件。
     * 所以：先置空 body → 再把状态显式写回 200 → 最后补回 type/length。
     */
    if (ctx.method === 'HEAD') {
      ctx.body = null;
      ctx.status = 200;
      ctx.type = path.extname(abs) || 'application/octet-stream';
      ctx.length = st.size;
      return;
    }

    /**
     * Range 支持。
     *
     * 既然回头发了 Accept-Ranges: bytes，就必须真的处理 Range —— 只报不办
     * 会让视频播放器误判：它以为能边下边播/拖进度，实际每次都收到整段 200，
     * 大一点的文件在微信里就会先转圈再"加载失败"。
     * 只实现单段 range（bytes=a-b / bytes=a- / bytes=-n），多段 range 按规范
     * 可以不管，退回整文件即可。
     */
    const range = ctx.get('range');
    let start = 0;
    let end = st.size - 1;

    if (range && /^bytes=\d*-\d*$/.test(range.trim())) {
      const [rawA, rawB] = range.trim().slice(6).split('-');
      if (rawA === '') {
        // bytes=-500 → 最后 500 字节
        const n = Number(rawB);
        if (!n) { ctx.status = 416; ctx.set('Content-Range', `bytes */${st.size}`); return; }
        start = Math.max(0, st.size - n);
      } else {
        start = Number(rawA);
        if (rawB !== '') end = Math.min(Number(rawB), st.size - 1);
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= st.size) {
        ctx.status = 416;
        ctx.set('Content-Range', `bytes */${st.size}`);
        return;
      }
      ctx.status = 206;
      ctx.set('Content-Range', `bytes ${start}-${end}/${st.size}`);
    }

    ctx.length = end - start + 1;
    ctx.body = fs.createReadStream(abs, { start, end });
  });
}

// ------------------------------------------------------------------ 业务路由

app.use(publicRouter.routes()).use(publicRouter.allowedMethods());
app.use(adminRouter.routes()).use(adminRouter.allowedMethods());

// ------------------------------------------------------------------ 前端静态托管

const WEB_DIST = path.resolve(config.root, '../web/dist');
const hasWeb = fs.existsSync(path.join(WEB_DIST, 'index.html'));

/**
 * 入口 HTML 一律不许缓存。这条不是洁癖，是踩出来的：
 *
 * Vite 构建出来的 js/css 文件名里带内容 hash（`Home-BD9KoKha.css`），
 * 发一次新版，**旧 hash 的文件就没了**。如果浏览器把 `index.html` 缓存住，
 * 它就会拿着昨天那份 index.html 去请求已经被删掉的旧 js/css → 全部 404 → **白屏**。
 *
 * 真事：本机重新 build 后跑验收，服务端日志里就出现
 * `GET /assets/Home-BD9KoKha.css 404` —— 浏览器用的还是缓存里的旧 index.html。
 * 活动期间发版修 bug 时，这就是"部分家长突然打不开"的成因，而且极难复现。
 *
 * 对策是标准做法：**入口 HTML 不缓存（每次回源校验），带 hash 的静态资源长缓存**。
 * 带 hash 的文件内容变了文件名就变，所以长缓存是安全的。
 */
const NO_CACHE = 'no-cache, no-store, must-revalidate';

if (hasWeb) {
  app.use(serve(WEB_DIST, {
    index: 'index.html',
    maxage: 3600 * 1000,
    setHeaders(res, filePath) {
      const base = path.basename(filePath);
      const rel = path.relative(WEB_DIST, filePath).replace(/\\/g, '/');
      if (base === 'index.html' || rel === 'sw.js') {
        res.setHeader('Cache-Control', NO_CACHE);
        return;
      }
      if (rel.startsWith('assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
}

/**
 * 前端路由 fallback。
 * 必须放在所有 /api 路由之后，否则 /api/xxx 会被 index.html 吃掉，
 * 前端拿到一坨 HTML 去 JSON.parse，报出让人摸不着头脑的错。
 */
app.use(async (ctx, next) => {
  if (ctx.path.startsWith('/api/') || ctx.path.startsWith('/media/')) return next();

  // 前端构建产物存在 → 交给 SPA 路由；不存在 → 给一个能看懂的提示页
  if (hasWeb && ctx.method === 'GET' && !ctx.path.includes('.')) {
    ctx.type = 'html';
    // 走 SPA 路由的页面同样是"入口 HTML"，一律不许缓存（理由见上面 NO_CACHE 那段）
    ctx.set('Cache-Control', NO_CACHE);
    ctx.body = fs.createReadStream(path.join(WEB_DIST, 'index.html'));
    return;
  }
  if (!hasWeb && ctx.path === '/') {
    ctx.type = 'html';
    ctx.body = `<meta charset="utf-8"><body style="font:16px/1.8 system-ui;padding:40px;max-width:640px;margin:auto">
      <h2>打卡后端已启动</h2>
      <p>但还没找到前端构建产物 <code>web/dist/index.html</code>。</p>
      <p>开发时请另开一个终端运行 <code>cd web &amp;&amp; npm run dev</code>，<br>
         上线前运行 <code>cd web &amp;&amp; npm run build</code> 后重启本服务。</p>
      <p>健康检查：<a href="/api/health">/api/health</a></p>
    </body>`;
    return;
  }
  return next();
});

// ------------------------------------------------------------------ 启动

async function boot() {
  const warnings = config.selfCheck();

  console.log('');
  console.log('  清城少年志 · 国庆打卡工具');
  console.log(`  环境 ${config.env}  |  端口 ${config.port}  |  存储 ${config.storage.driver}  |  北京日期 ${time.today()}`);
  console.log('');

  // 连库自检：失败也给服务，让 /api/health 能说话
  try {
    const h = await db.health();
    console.log(`  数据库 OK  ${config.db.host}:${config.db.port}/${config.db.database}`);
    console.log(`  MySQL ${h.version}  |  字符集 ${h.cs}  |  库时间 ${h.now}`);
  } catch (e) {
    console.log('  ⚠ 数据库连接失败：' + (e.code || '') + ' ' + e.message);
    console.log('    服务仍会启动，但打卡接口会报错。请检查 .env 里的 DB_* 配置与账号授权。');
    warnings.push('数据库连不上');
  }

  if (!hasWeb) console.log('  ⚠ 未找到 web/dist，仅提供 API（前端请单独跑 vite dev）');
  if (config.storage.driver === 'local' && config.transcode.enabled) {
    const transcode = require('./services/transcode');
    console.log(`  服务端视频转码：${transcode.isAvailable() ? 'ffmpeg 就绪，已启用兜底压缩' : '⚠ ffmpeg 不可用，视频将保留原片（详见下方警告）'}`);
  }
  if (warnings.length) {
    console.log('');
    warnings.forEach((w) => console.log('  ⚠ ' + w));
  }
  console.log('');

  const server = app.listen(config.port, () => {
    console.log(`  已启动：http://127.0.0.1:${config.port}`);
    console.log(`  家长入口：http://127.0.0.1:${config.port}/`);
    console.log(`  管理后台：http://127.0.0.1:${config.port}/admin`);
    console.log('');
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`端口 ${config.port} 已被占用。改 .env 里的 PORT，或先停掉占用进程。`);
    } else {
      console.error('服务启动失败：', e);
    }
    process.exit(1);
  });

  const shutdown = async (sig) => {
    console.log(`\n收到 ${sig}，正在关闭…`);
    server.close();
    await db.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  boot().catch((e) => {
    console.error('启动异常：', e);
    process.exit(1);
  });
}

module.exports = { app, boot };
