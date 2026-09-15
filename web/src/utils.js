/**
 * utils.js —— 格式化、压缩、上传等纯函数。
 */

/** 幂等键：优先用原生 randomUUID，降级到时间戳+随机串（都满足后端的 8-64 位校验） */
export function uuid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'r' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

export function fmtSizeMB(n) {
  return (Number(n || 0) / 1048576).toFixed(1) + ' MB';
}

/** 手机号打码：家长在自己页面看自己的号，也给个中间四位星号，截图发群里不泄露 */
export function maskPhone(p) {
  const s = String(p || '');
  return s.length === 11 ? `${s.slice(0, 3)}****${s.slice(7)}` : s;
}

/** '2026-10-03' → '10月3日' */
export function mdText(dateStr) {
  const [, m, d] = String(dateStr || '').split('-');
  if (!m || !d) return dateStr || '';
  return `${Number(m)}月${Number(d)}日`;
}

export function hhmm(datetime) {
  const s = String(datetime || '');
  const m = /(\d{2}):(\d{2})/.exec(s.slice(11));
  return m ? `${m[1]}:${m[2]}` : '';
}

/** 主题色：与设计令牌里能用的色相一一对应，用于图表区分 */
export const THEME_COLORS = {
  专注: '#0f68ea',
  乐观: '#ffcb00',
  希望: '#39b54a',
  自信: '#df37a7',
  感恩: '#ff8a3d',
  坚韧: '#8b5cf6',
  活力: '#12b5b0',
};

export function themeColor(theme) {
  return THEME_COLORS[theme] || '#1d1d1f';
}

/** 参与者端的 7 个主题顺序（后端也是这个顺序，保持视觉一致） */
export const THEMES = ['专注', '乐观', '希望', '自信', '感恩', '坚韧', '活力'];

// ------------------------------------------------------------------ 图片压缩

/**
 * 手机直出照片动辄 4-8MB，1000 人一天几百张就是几个 GB。
 * 在客户端先压到长边 1600px、JPEG 0.82，通常落到 300-600KB，
 * 肉眼在手机上几乎看不出差别，但上传成功率和流量成本差别巨大。
 *
 * HEIC（iPhone 默认格式）多数浏览器无法解码成 Image，
 * 这时直接返回原文件交给后端 —— 宁可不压，也不能让用户传不上去。
 */
export async function compressImage(file, { maxEdge = 1600, quality = 0.82 } = {}) {
  const type = String(file.type || '').toLowerCase();
  if (!/^image\/(jpeg|jpg|png|webp)$/.test(type)) {
    return { file, compressed: false, note: 'HEIC/其它格式已原图上传' };
  }
  if (file.size < 400 * 1024) return { file, compressed: false, note: '' };

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (e) {
    return { file, compressed: false, note: '' };
  }

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();

  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  if (!blob || blob.size >= file.size) return { file, compressed: false, note: '' };

  const out = new File([blob], renameExt(file.name, 'jpg'), { type: 'image/jpeg', lastModified: Date.now() });
  return { file: out, compressed: true, note: `已压缩 ${fmtBytes(file.size)} → ${fmtBytes(out.size)}` };
}

function renameExt(name, ext) {
  const s = String(name || 'photo');
  const i = s.lastIndexOf('.');
  return (i > 0 ? s.slice(0, i) : s) + '.' + ext;
}

/** 读视频时长（秒）与首帧缩略图；失败返回 null，不阻塞上传 */
export function probeVideo(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;

    const done = (result) => {
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const timer = setTimeout(() => done(null), 8000);

    v.onloadedmetadata = () => {
      const duration = Math.round(v.duration || 0);
      // 抽首帧做封面，上传列表里不用等视频加载
      try {
        const c = document.createElement('canvas');
        c.width = 160;
        c.height = Math.round(160 * (v.videoHeight / v.videoWidth || 1));
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        clearTimeout(timer);
        done({ duration, poster: c.toDataURL('image/jpeg', 0.6), width: v.videoWidth, height: v.videoHeight });
      } catch (e) {
        clearTimeout(timer);
        done({ duration, poster: '', width: v.videoWidth, height: v.videoHeight });
      }
    };
    v.onerror = () => { clearTimeout(timer); done(null); };
    v.src = url;
  });
}

// ------------------------------------------------------------------ 视频压缩

/**
 * 视频压缩（best-effort，浏览器端，上传前执行）。
 *
 * 仅在浏览器支持 MediaRecorder 且能产出 MP4 时尝试；否则原样返回，
 * 绝不让用户"传不上去"或拿到一个无声/损坏的视频。
 *
 * 原理：用隐藏 <video> 播放原片，把每一帧 drawImage 到缩小后的 canvas，
 * 经 canvas.captureStream 喂给 MediaRecorder，音频走 AudioContext 接回，
 * 按受限码率重新封装成 MP4。这是「实时重编码」，耗时≈原视频时长，
 * 所以只对本机/现代浏览器有意义；微信内置浏览器大多不支持 MP4 录制，
 * 会直接命中下面的回退分支上传原片——不会更糟，只是没省到。
 *
 * 失败 / 不支持 / 结果没变小 / 超时 → 一律回退原片（compressed:false）。
 */
export async function compressVideo(file, {
  maxEdge = 720,
  videoBitrate = 1200000,
  audioBitrate = 96000,
  fps = 24,
  timeoutMs = 150000,
  onProgress,
} = {}) {
  const type = String(file.type || '').toLowerCase();
  if (!/^video\//.test(type)) return { file, compressed: false, note: '' };

  const hasMR = typeof MediaRecorder !== 'undefined';
  const canCapture = typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  if (!hasMR || !canCapture) {
    return { file, compressed: false, note: '当前浏览器不支持视频压缩，已原画上传' };
  }

  // 只接受能产出 MP4 的录制器；其它格式（如 webm）后端 magic 不认，必须放弃
  const mp4Mime = ['video/mp4;codecs=h264,aac', 'video/mp4']
    .find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m));
  if (!mp4Mime) {
    return { file, compressed: false, note: '当前浏览器不支持 MP4 压缩，已原画上传' };
  }

  // 太小不值得压；太长实时重编码太久，直接放弃
  if (file.size < 1.5 * 1024 * 1024) return { file, compressed: false, note: '' };

  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.src = url;

  let duration = 0;
  let vw = 0;
  let vh = 0;
  try {
    await new Promise((resolve, reject) => {
      v.onloadedmetadata = () => { duration = v.duration || 0; vw = v.videoWidth; vh = v.videoHeight; resolve(); };
      v.onerror = () => reject(new Error('meta'));
    });
  } catch (e) {
    URL.revokeObjectURL(url);
    return { file, compressed: false, note: '' };
  }

  if (!isFinite(duration) || duration > 100) {
    URL.revokeObjectURL(url);
    return { file, compressed: false, note: '视频较长，已原画上传' };
  }

  const scale = Math.min(1, maxEdge / Math.max(vw || 1, vh || 1));
  const tw = Math.max(2, Math.round((vw || 0) * scale));
  const th = Math.max(2, Math.round((vh || 0) * scale));

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const cctx = canvas.getContext('2d');

  // 音频：能接就接，接不上就放弃压缩（绝不出无声视频）
  let audioCtx = null;
  let dest = null;
  let srcNode = null;
  let audioFailed = false;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) audioFailed = true;
    else {
      audioCtx = new AC();
      await audioCtx.resume().catch(() => {});
      dest = audioCtx.createMediaStreamDestination();
      srcNode = audioCtx.createMediaElementSource(v);
      srcNode.connect(dest);
    }
  } catch (e) {
    audioFailed = true;
  }

  let stream;
  try {
    stream = canvas.captureStream(fps);
  } catch (e) {
    cleanup();
    return { file, compressed: false, note: '' };
  }

  if (audioFailed) {
    // 无法捕获音频，避免产出无声视频
    cleanup();
    return { file, compressed: false, note: '' };
  }
  if (dest && dest.stream.getAudioTracks().length) {
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  }

  let recorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: mp4Mime,
      videoBitsPerSecond: videoBitrate,
      audioBitsPerSecond: audioBitrate,
    });
  } catch (e) {
    cleanup();
    return { file, compressed: false, note: '' };
  }

  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  let aborted = false;
  const timer = setTimeout(() => { aborted = true; try { recorder.stop(); } catch (e) {} }, timeoutMs);
  const stopped = new Promise((resolve) => {
    recorder.onstop = () => { clearTimeout(timer); resolve(); };
  });

  let played = true;
  try { await v.play(); } catch (e) { played = false; }
  if (!played) { cleanup(); return { file, compressed: false, note: '' }; }

  recorder.start(200);

  await new Promise((resolve) => {
    function frame() {
      if (aborted || v.ended || v.currentTime >= duration) return resolve();
      try { cctx.drawImage(v, 0, 0, tw, th); } catch (e) { /* 偶发绘制失败忽略 */ }
      if (onProgress && duration > 0) {
        try { onProgress(Math.min(1, v.currentTime / duration)); } catch (e) { /* 忽略 */ }
      }
      requestAnimationFrame(frame);
    }
    frame();
  });

  if (!aborted) { try { recorder.stop(); } catch (e) {} }
  await stopped;

  cleanup();

  if (aborted || !chunks.length) return { file, compressed: false, note: '' };

  const blob = new Blob(chunks, { type: 'video/mp4' });
  if (blob.size <= 0 || blob.size >= file.size) {
    return { file, compressed: false, note: '' };
  }

  const out = new File([blob], renameExt(file.name, 'mp4'), { type: 'video/mp4', lastModified: Date.now() });
  return {
    file: out,
    compressed: true,
    note: `已压缩 ${fmtBytes(file.size)} → ${fmtBytes(out.size)}`,
  };

  function cleanup() {
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* ignore */ }
    URL.revokeObjectURL(url);
    if (srcNode) try { srcNode.disconnect(); } catch (e) { /* ignore */ }
    if (dest) try { dest.disconnect(); } catch (e) { /* ignore */ }
    if (audioCtx) try { audioCtx.close(); } catch (e) { /* ignore */ }
  }
}

// ------------------------------------------------------------------ 上传

/**
 * 带进度的上传。
 * fetch 没有上传进度事件，所以这里用 XHR —— 手机上传几十 MB 视频时，
 * 有没有进度条是"用户以为卡死然后关掉页面"的分水岭。
 *
 * @param {{url:string, method?:string, form:FormData, headers?:object, onProgress?:Function, timeout?:number}} opts
 */
export function uploadWithProgress({ url, method = 'POST', form, headers = {}, onProgress, timeout = 300000 }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.timeout = timeout;

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch (e) { /* 七牛成功时可能返回空体或非 JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body || {});
      else reject(new Error((body && body.message) || `上传失败（${xhr.status}）`));
    };
    xhr.onerror = () => reject(new Error('上传中断，请检查网络'));
    xhr.ontimeout = () => reject(new Error('上传超时，请换更小的文件或换个网络'));
    xhr.onabort = () => reject(new Error('上传已取消'));
    xhr.send(form);
  });
}

/**
 * 按后端给的 ticket 上传一个文件。
 * local 驱动 → 打我们自己的中转接口；qiniu 驱动 → 直传七牛。
 * 两种模式对调用方完全一致。
 */
export async function uploadByTicket(ticket, file, { onProgress, token } = {}) {
  if (ticket.mode === 'qiniu') {
    const form = new FormData();
    form.append('token', ticket.token);
    form.append('key', ticket.key);
    form.append('file', file);
    return uploadWithProgress({
      url: ticket.uploadHost,
      form,
      onProgress,
      headers: {}, // 七牛不接受自定义头，跨域会被拦
    });
  }

  const form = new FormData();
  form.append('file', file);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return uploadWithProgress({
    url: `/api/upload/local?key=${encodeURIComponent(ticket.key)}`,
    form,
    headers,
    onProgress,
  });
}

// ------------------------------------------------------------------ 杂项

export function debounce(fn, wait = 300) {
  let t = null;
  return function debounced(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

/** 复制文本（微信里 document.execCommand 兼容性比 navigator.clipboard 好） */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* 落到下面的兜底 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

export function shareMessage(title, url) {
  return { title, path: url, desc: title };
}
