<template>
  <div class="uploader">
    <!-- 照片：必填 -->
    <div class="uploader__block">
      <div class="uploader__head">
        <span class="o-label" style="margin: 0">
          照片<span class="o-label__req">*</span>
        </span>
        <span class="o-text-caption o-text-muted">
          {{ photos.length }}/{{ limits.photoMaxCount }} 张 · 每张不超过 {{ limits.photoMaxMB }}MB
        </span>
      </div>

      <div class="o-thumbs">
        <div v-for="(item, i) in photos" :key="item.uid" class="o-thumb">
          <img :src="item.preview" :alt="`照片${i + 1}`" />
          <div v-if="item.state === 'uploading'" class="o-thumb__bar">
            <i :style="{ width: item.progress + '%' }"></i>
          </div>
          <div v-else-if="item.state === 'error'" class="o-thumb__tag" style="background: rgba(165,28,28,.85)">失败</div>
          <button v-if="!disabled && item.state !== 'uploading'" class="o-thumb__x no-select" @click="remove(i)">×</button>
        </div>

        <button
          v-if="!disabled && photos.length < limits.photoMaxCount"
          class="o-addbtn no-select"
          type="button"
          @click="pick('image')"
        >
          <span class="o-addbtn__plus">＋</span>
          <span>加照片</span>
        </button>
      </div>

      <p v-if="photoError" class="errline">{{ photoError }}</p>
    </div>

    <!-- 视频：选填 -->
    <div v-if="limits.videoMaxCount > 0" class="uploader__block">
      <div class="uploader__head">
        <span class="o-label" style="margin: 0">
          视频<span class="o-text-caption o-text-muted" style="font-weight: 400">（选填）</span>
        </span>
        <span class="o-text-caption o-text-muted">
          {{ videos.length }}/{{ limits.videoMaxCount }} 段 · 不超过 {{ limits.videoMaxMB }}MB 且 {{ limits.videoMaxSec }} 秒
        </span>
      </div>

      <div class="o-thumbs">
        <div v-for="(item, i) in videos" :key="item.uid" class="o-thumb">
          <img v-if="item.poster" :src="item.poster" alt="视频封面" />
          <div v-else class="vidfallback">▶</div>
          <div v-if="item.state === 'uploading'" class="o-thumb__bar">
            <i :style="{ width: item.progress + '%' }"></i>
          </div>
          <div v-else-if="item.state === 'error'" class="o-thumb__tag" style="background: rgba(165,28,28,.85)">失败</div>
          <button v-if="!disabled && item.state !== 'uploading'" class="o-thumb__x no-select" @click="remove(i, 'video')">×</button>
        </div>

        <button
          v-if="!disabled && videos.length < limits.videoMaxCount"
          class="o-addbtn no-select"
          type="button"
          @click="pick('video')"
        >
          <span class="o-addbtn__plus">＋</span>
          <span>加视频</span>
        </button>
      </div>

      <p v-if="videoError" class="errline">{{ videoError }}</p>
    </div>

    <p v-if="notice" class="o-hint" style="color: var(--color-forest)">{{ notice }}</p>

    <!-- 隐藏的原生选择器：一次只处理一个文件，串行上传，成功率比并发高 -->
    <input
      ref="photoInput"
      type="file"
      accept="image/*"
      multiple
      style="display: none"
      @change="onPicked($event, 'image')"
    />
    <input
      ref="videoInput"
      type="file"
      accept="video/*"
      style="display: none"
      @change="onPicked($event, 'video')"
    />
  </div>
</template>

<script setup>
/**
 * MediaUploader —— 照片必填 / 视频选填的上传区。
 *
 * 几个刻意的取舍：
 *   · 串行上传（不并发）：手机并发传两个大文件容易一起失败，串行慢一点但稳。
 *   · 图片先压缩再上传：手机直出 4-8MB，压到 1600px/0.82 通常剩 300-600KB。
 *   · 上传成功即拿到 key，key 才是提交时要传的东西；
 *     预览用本地 objectURL，不依赖云存储域名能否访问。
 *   · 失败的项目保留在列表里可删可重试，而不是静默消失。
 */
import { ref, computed, watch } from 'vue';
import { api, store } from '../api.js';
import { compressImage, probeVideo, compressVideo, uploadByTicket, uuid, fmtBytes } from '../utils.js';
import { toastErr, toastWarn, toast } from '../toast.js';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  limits: {
    type: Object,
    default: () => ({ photoMaxMB: 10, videoMaxMB: 30, photoMaxCount: 9, videoMaxCount: 1, videoMaxSec: 90 }),
  },
  taskId: { type: [Number, String], default: null },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue', 'busy']);

const photoInput = ref(null);
const videoInput = ref(null);
const photoError = ref('');
const videoError = ref('');
const notice = ref('');
const busyCount = ref(0);

const photos = computed(() => props.modelValue.filter((m) => m.type === 'image'));
const videos = computed(() => props.modelValue.filter((m) => m.type === 'video'));

const all = () => [...props.modelValue];

function update(list) {
  emit('update:modelValue', list);
}

watch(busyCount, (n) => emit('busy', n > 0));

function pick(type) {
  photoError.value = '';
  videoError.value = '';
  notice.value = '';
  const el = type === 'image' ? photoInput.value : videoInput.value;
  if (el) {
    el.value = ''; // 允许重复选同一个文件
    el.click();
  }
}

async function onPicked(e, type) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const isVideo = type === 'video';
  const maxMB = isVideo ? props.limits.videoMaxMB : props.limits.photoMaxMB;
  const maxCount = isVideo ? props.limits.videoMaxCount : props.limits.photoMaxCount;
  const room = maxCount - (isVideo ? videos.value.length : photos.value.length);

  if (files.length > room) {
    (isVideo ? videoError : photoError).value = `最多还能加 ${room} 个，已自动截断`;
    toastWarn(`最多还能加 ${room} 个`);
  }

  for (const raw of files.slice(0, Math.max(0, room))) {
    // eslint-disable-next-line no-await-in-loop
    await handleOne(raw, type, maxMB);
  }
  e.target.value = '';
}

async function handleOne(raw, type, maxMB) {
  const isVideo = type === 'video';
  const errRef = isVideo ? videoError : photoError;
  errRef.value = '';

  // ---- 1. 前置校验：先在本地拦掉，别浪费用户流量 ----
  if (!raw.size) { errRef.value = '这个文件是空的，请重新选择'; return; }

  let file = raw;
  let poster = '';
  let duration = null;

  if (isVideo) {
    const info = await probeVideo(raw);
    if (info) {
      duration = info.duration;
      poster = info.poster;
      if (duration > props.limits.videoMaxSec + 3) {
        errRef.value = `视频 ${duration} 秒，超过 ${props.limits.videoMaxSec} 秒上限，请剪辑后再传`;
        toastErr(errRef.value);
        return;
      }
    }
    // 上传前尽力压缩（支持的浏览器会重编码成小体积 MP4，不支持则回退原片）
    notice.value = '视频压缩中…';
    try {
      const r = await compressVideo(raw, {
        maxEdge: 720,
        videoBitrate: 1200000,
        audioBitrate: 96000,
      });
      file = r.file;
      notice.value = r.note || '';
    } catch (e) {
      notice.value = '';
    }
  } else {
    const r = await compressImage(raw);
    file = r.file;
    if (r.note) notice.value = r.note;
  }

  if (file.size > maxMB * 1024 * 1024) {
    errRef.value = `${isVideo ? '视频' : '照片'} ${fmtBytes(file.size)}，超过 ${maxMB}MB 上限`;
    toastErr(errRef.value);
    return;
  }

  // ---- 2. 占位入列（先显示进度条，用户知道在动）----
  const uid = uuid();
  const preview = isVideo ? '' : URL.createObjectURL(file);
  const item = {
    uid, type, preview, poster, duration,
    name: file.name, size: file.size, mime: file.type,
    key: '', url: '', state: 'uploading', progress: 0,
  };
  update([...all(), item]);
  busyCount.value += 1;

  // ---- 3. 领凭证 → 上传 ----
  try {
    const ticket = await api.uploadTicket({
      type, mime: file.type, size: file.size, fileName: file.name,
      taskId: props.taskId || undefined,
    });
    item.maxBytes = ticket.maxBytes;

    await uploadByTicket(ticket, file, {
      token: store.pToken,
      onProgress: (p) => {
        const cur = all().find((x) => x.uid === uid);
        if (cur) cur.progress = p;
      },
    });

    patch(uid, {
      key: ticket.key,
      url: ticket.previewUrl || '',
      state: 'done',
      progress: 100,
      // 本地驱动下后端会回写真实大小，但这里先用本地值，提交时会以后端为准
      size: file.size,
    });
  } catch (err) {
    patch(uid, { state: 'error', error: err.message });
    errRef.value = err.message;
    toastErr(err.message);
  } finally {
    busyCount.value -= 1;
  }
}

function patch(uid, fields) {
  update(all().map((x) => (x.uid === uid ? { ...x, ...fields } : x)));
}

function remove(index, type) {
  const target = type === 'video' ? videos.value[index] : photos.value[index];
  if (!target) return;
  if (target.preview && String(target.preview).startsWith('blob:')) {
    URL.revokeObjectURL(target.preview);
  }
  update(all().filter((x) => x.uid !== target.uid));
  if (type === 'video') videoError.value = '';
  else photoError.value = '';
}

/** 父组件提交前调用：是否还有在传的文件 */
function hasUploading() {
  return props.modelValue.some((m) => m.state === 'uploading');
}
/** 父组件提交前调用：全部失败的文件 */
function failures() {
  return props.modelValue.filter((m) => m.state === 'error');
}

defineExpose({ hasUploading, failures });
</script>

<style scoped>
.uploader { display: flex; flex-direction: column; gap: 20px; }
.uploader__block { display: flex; flex-direction: column; gap: 10px; }
.uploader__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: space-between;
}
.errline {
  font-size: var(--text-caption);
  color: var(--color-strawberry);
  line-height: 1.5;
}
.vidfallback {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  font-size: 24px; color: var(--color-heather);
  background: #f2eef2;
}
</style>
