'use strict';

/**
 * 集中读取环境变量，给全项目一份只读配置。
 * 任何模块都不要直接读 process.env，统一从这里取，方便排查。
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
if (fs.existsSync(ENV_FILE)) dotenv.config({ path: ENV_FILE });

function str(key, def = '') {
  const v = process.env[key];
  return v === undefined || v === '' ? def : String(v).trim();
}
function num(key, def) {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : def;
}
function bool(key, def = false) {
  const v = str(key, '');
  if (!v) return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const config = {
  root: ROOT,
  env: str('NODE_ENV', 'development'),
  port: num('PORT', 3000),

  db: {
    host: str('DB_HOST', '127.0.0.1'),
    port: num('DB_PORT', 3306),
    user: str('DB_USER', 'root'),
    password: str('DB_PASSWORD', ''),
    database: str('DB_NAME', 'daka'),
    connectionLimit: num('DB_CONNECTION_LIMIT', 10),
    timezone: '+08:00',
    charset: 'utf8mb4',
  },

  jwt: {
    secret: str('JWT_SECRET', 'dev-secret-please-change'),
    expiresIn: str('JWT_EXPIRES_IN', '12h'),
    // 参与者侧 token 有效期长一些：活动 7 天 + 回看期，避免家长中途要重新登记
    participantExpiresIn: str('PARTICIPANT_TOKEN_EXPIRES_IN', '60d'),
  },

  adminInit: {
    username: str('ADMIN_INIT_USER', 'admin'),
    password: str('ADMIN_INIT_PASSWORD', ''),
  },

  // ---------------- 存储 ----------------
  storage: {
    driver: str('STORAGE_DRIVER', 'local'), // local | qiniu
    local: {
      dir: path.resolve(ROOT, str('LOCAL_UPLOAD_DIR', './uploads')),
      // 生成媒体直链用的外部前缀（local 驱动）
      publicBase: str('PUBLIC_BASE_URL', '').replace(/\/+$/, ''),
    },
    qiniu: {
      accessKey: str('QN_ACCESS_KEY', ''),
      secretKey: str('QN_SECRET_KEY', ''),
      bucket: str('QN_BUCKET', ''),
      region: str('QN_REGION', 'z0'),
      // 访问域名（CDN），不带协议也行，会补 https
      domain: str('QN_DOMAIN', '').replace(/\/+$/, ''),
      private: bool('QN_PRIVATE', false),
      uploadHost: str('QN_UPLOAD_HOST', ''), // 一般不用填，SDK 会按 region 推导
      tokenExpiresSec: num('QN_TOKEN_EXPIRES_SEC', 3600),
    },
  },

  // ---------------- 上传限制 ----------------
  upload: {
    photoMaxMB: num('PHOTO_MAX_MB', 10),
    videoMaxMB: num('VIDEO_MAX_MB', 30),
    videoMaxSec: num('VIDEO_MAX_SEC', 90),
    photoMaxCount: num('PHOTO_MAX_COUNT', 9),
    videoMaxCount: num('VIDEO_MAX_COUNT', 1),
    imageMime: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    videoMime: ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/3gpp'],

    /**
     * multipart 落盘的临时目录。
     *
     * 两个必须注意的点：
     * 1. **必须存在**。formidable v2 直接 `new fs.WriteStream(filepath)`，
     *    目录不在时写流异步报错、但 parse 回调仍返回成功 —— 表现就是
     *    「上传接口 500 / 文件明明传了却读不到」，而且报错信息毫无线索。
     *    所以启动时显式 mkdir（见 index.js）。
     * 2. **放在媒体根目录之外**。放在 uploads/ 里面的话，残留的临时文件
     *    会被当成正常媒体被打包、被清理任务误扫，归档时混进杂物。
     */
    tmpDir: path.resolve(ROOT, str('UPLOAD_TMP_DIR', './.tmp-uploads')),

    // 临时文件多久没被领走就删掉（分钟）。视频可能传到一半断网，
    // 这些残片不清会一直占着磁盘
    tmpMaxAgeMin: num('UPLOAD_TMP_MAX_AGE_MIN', 60),
  },

  // ---------------- 服务端视频转码（local 驱动兜底）----------------
  transcode: {
    /**
     * 默认只在 local 驱动下开启：文件过我们服务器，才有机会在落盘前转码。
     * qiniu 直传模式下文件不过服务器，开启无意义（public.js 也不会调用）。
     * 显式设 VIDEO_TRANSCODE_ENABLED=false 可关闭；设 true 则强制开启。
     */
    enabled: bool('VIDEO_TRANSCODE_ENABLED', str('STORAGE_DRIVER', 'local') === 'local'),
    // ffmpeg 可执行文件路径。默认依赖 PATH 里的 ffmpeg；找不到就填绝对路径
    ffmpegBin: str('FFMPEG_BIN', 'ffmpeg'),
    // 转码目标：高度不超过此值（保持比例，不放大）
    maxHeight: num('VIDEO_TRANSCODE_MAX_HEIGHT', 720),
    // 视频目标码率（kbps）
    videoBitrateK: num('VIDEO_TRANSCODE_VBR_K', 1200),
    // 音频目标码率（kbps）
    audioBitrateK: num('VIDEO_TRANSCODE_ABR_K', 96),
    // 编码速度/压缩率权衡（veryfast 够快，文件略大；medium 更慢更小）
    preset: str('VIDEO_TRANSCODE_PRESET', 'veryfast'),
    // 源小于此值（MB）不转：已经够小，转了反而费 CPU 还可能变大
    minSourceMB: num('VIDEO_TRANSCODE_MIN_SRC_MB', 2),
    // 单次转码超时（毫秒）。超时杀掉回退原片，避免卡死上传请求
    timeoutMs: num('VIDEO_TRANSCODE_TIMEOUT_MS', 120000),
  },

  cors: {
    // "*" 表示全放开（仅开发期）。上线前换成前端域名，逗号分隔
    origins: str('CORS_ORIGINS', '*')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  // ---------------- 业务参数（可被数据库 daka_config 覆盖）----------------
  activity: {
    startDate: str('ACTIVITY_START', '2026-10-01'),
    endDate: str('ACTIVITY_END', '2026-10-07'),
    title: str('ACTIVITY_TITLE', '清城少年志 · 国庆七天打卡'),
    hzAllThemes: num('HONOR_ALL_THEMES', 1), // 全能少年：每个主题至少 1 次
    hzThemeStar: num('HONOR_THEME_STAR', 3), // 主题之星：单主题 ≥3 次
    hzDakaMaster: num('HONOR_DAKA_MASTER', 14), // 打卡达人：累计 ≥14 次
  },

  // 服务端按北京时间判定"今天"，不信任客户端传的日期
  tzOffsetMinutes: 8 * 60,

  // ---------------- 活动前演练用的「模拟今天」----------------
  /**
   * 活动 10/1 才开始，可 9 月就得把整套提交流程真跑一遍（不然只能等到
   * 10/1 当天才发现问题）。所以留一个时钟开关：
   *
   *   NODE_ENV=development
   *   DAKA_ALLOW_CLOCK_OVERRIDE=1
   *   DAKA_TODAY=2026-10-01
   *
   * 三重保险，任何一层没满足就完全不起作用：
   *   1) NODE_ENV 不能是 production —— 生产环境直接忽略这个开关，
   *      上线时即使忘了删环境变量也不会把打卡日期算错。
   *   2) 必须显式给 DAKA_ALLOW_CLOCK_OVERRIDE=1。
   *   3) DAKA_TODAY 必须是合法的 YYYY-MM-DD。
   */
  debug: {
    today: (str('NODE_ENV', 'development') !== 'production'
      && bool('DAKA_ALLOW_CLOCK_OVERRIDE')
      && /^\d{4}-\d{2}-\d{2}$/.test(str('DAKA_TODAY', '')))
      ? str('DAKA_TODAY', '')
      : '',
    // 生产环境里有人试图开这个开关时，日志里要说一句，不能静默忽略
    clockOverrideIgnored: str('NODE_ENV', 'development') === 'production'
      && bool('DAKA_ALLOW_CLOCK_OVERRIDE'),
  },
};

/** 是否处于"模拟日期"状态 —— 前端要在最显眼处打横幅，别让家长看见 */
config.clockOverridden = () => Boolean(config.debug.today);

/** 生产环境的安全自检，启动时打印警告 */
config.selfCheck = function selfCheck() {
  const warn = [];
  if (config.debug.today) {
    warn.push(`★ 时钟已被覆盖：全站「今天」= ${config.debug.today}（演练模式，上线前请删掉 DAKA_ALLOW_CLOCK_OVERRIDE）`);
  }
  if (config.debug.clockOverrideIgnored) {
    warn.push('检测到 DAKA_ALLOW_CLOCK_OVERRIDE，但当前是 production 环境，已按真实日期运行（这个开关只在开发环境生效）');
  }
  if (config.env === 'production') {
    if (config.jwt.secret.includes('change')) warn.push('JWT_SECRET 还是默认值，请更换');
    if (config.cors.origins.includes('*')) warn.push('CORS_ORIGINS 还是 *，建议改成前端域名');
    if (!config.adminInit.password) warn.push('未设置 ADMIN_INIT_PASSWORD（仅首次建库需要）');

    // 图片/视频链接会直接把 PUBLIC_BASE_URL 拼在家长手机上。
    // 上线时要是忘了改，家长看到的就是 http://localhost:3000/xxx.jpg —— 一定打不开；
    // 而运维自己在服务器上用 127.0.0.1 访问又是正常的，很容易查半天。
    // 所以这里在 production 且指向本机时主动吼一声。
    const pb = config.storage.local.publicBase;
    if (config.storage.driver === 'local'
      && /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(pb)) {
      warn.push(`★ PUBLIC_BASE_URL 指向本机（${pb}），家长打开图片/视频会是坏链。`
        + '建议清空该配置 —— 留空就按访问域名自动生成。');
    }
  }
  if (config.storage.driver === 'qiniu') {
    const q = config.storage.qiniu;
    if (!q.accessKey || !q.secretKey || !q.bucket) warn.push('STORAGE_DRIVER=qiniu 但 AK/SK/bucket 不完整');
    if (!q.domain) warn.push('七牛未配置 QN_DOMAIN，上传能成功但媒体链接无法生成');
  }
  if (config.transcode.enabled && config.storage.driver === 'local') {
    // 避免在用户"以为开了服务端压缩"却实际没生效时安静失败。
    // 仅 local 驱动需要：qiniu 直传模式下文件不过我们服务器，转码本身不生效，无需 ffmpeg。
    let tcOk = false;
    try { tcOk = require('./services/transcode').isAvailable(); } catch (e) {}
    if (!tcOk) {
      warn.push('VIDEO_TRANSCODE_ENABLED=1 但系统未找到 ffmpeg，服务端视频压缩不会生效（将保留原片）。'
        + '请在服务器安装 ffmpeg 并加入 PATH，或用 FFMPEG_BIN 指定绝对路径。');
    }
  }
  return warn;
};

module.exports = config;
