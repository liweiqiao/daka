<template>
  <section v-if="visible" class="o-section" style="background: var(--color-paper-mist); border-top: 1px solid var(--color-ash); border-bottom: 1px solid var(--color-ash)">
    <div class="o-container">
      <div class="o-eyebrow" style="text-align: center">MOMENTS</div>
      <h2 class="o-h2" style="text-align: center">清城少年立志瞬间</h2>
      <p class="o-text-muted o-text-sm" style="text-align: center; margin-top: 10px; line-height: 1.7">
        <template v-if="total">
          今天，清城少年们这样过
        </template>
        <template v-else>
          孩子们交上来的打卡照片会出现在这里。
        </template>
      </p>

      <!-- 骨架：首次加载不留白 -->
      <div v-if="loading" class="wall" style="margin-top: 32px">
        <div v-for="i in 5" :key="i" class="o-skel" style="aspect-ratio: 4 / 5"></div>
      </div>

      <!-- 还没有照片（活动没开始、或刚开始还没人交）：说清楚，别让人以为墙坏了 -->
      <div v-else-if="!pool.length" class="o-card o-card--pad-lg" style="margin-top: 32px; text-align: center">
        <div class="o-label">还没有照片</div>
        <p class="o-text-sm o-text-muted" style="margin-top: 8px; line-height: 1.8">
          第一个完成打卡的孩子，照片就会出现在这里。
        </p>
      </div>

      <template v-else>
        <!-- 照片少时收拢列数，让卡片铺满整行，不留在空位 -->
        <div class="wall" :style="{ '--wall-cols': wallCols }" style="margin-top: 32px">
          <figure
            v-for="p in shown"
            :key="p.key"
            class="wall__item"
            @click="preview = p"
          >
            <div class="wall__frame">
              <img :src="p.url" alt="" loading="lazy" />
            </div>
            <figcaption class="wall__cap">
              <span class="wall__dot" :style="{ background: themeColor(p.theme) }"></span>
              <span class="wall__theme">{{ p.theme }}</span>
              <span class="wall__who">{{ p.name }}</span>
            </figcaption>
          </figure>
        </div>

        <p v-if="pool.length > PER_PAGE" class="o-text-caption o-text-muted" style="text-align: center; margin-top: 18px">
          每 {{ ROTATE_SEC }} 秒自动换一批 · 点开可以看大图
        </p>
      </template>
    </div>

    <!-- 看大图 -->
    <Modal :open="!!preview" :title="preview ? preview.theme : ''" wide @close="preview = null">
      <template v-if="preview">
        <img :src="preview.url" alt="" style="width: 100%; border-radius: var(--radius-inputs); display: block" />
        <p class="o-text-sm o-text-muted" style="margin-top: 12px; line-height: 1.7">
          {{ preview.name }} · {{ mdText(preview.date) }} · {{ preview.taskName }}
        </p>
      </template>
    </Modal>
  </section>
</template>

<script setup>
/**
 * MomentWall.vue —— 首页「清城少年立志瞬间」照片墙。
 *
 * 规则：
 *   - 数据来自 /api/gallery，后端已经做过去重（一个孩子一次只占一个位置）
 *     和姓名脱敏，这里只负责展示。
 *   - 一次显示 5 张，每 6 秒往下滚一批，滚完一圈从头再来。
 *   - 后台把 gallery_public 关掉时接口回 403，整块直接不渲染。
 *   - 页面切到后台就停掉定时器；家长在微信里挂着不看的页面不该一直转。
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import Modal from './Modal.vue';
import { api } from '../api.js';
import { themeColor, mdText } from '../utils.js';
import { toastErr } from '../toast.js';

const PER_PAGE = 5;
const ROTATE_SEC = 6;
const ROTATE_MS = ROTATE_SEC * 1000;

const loading = ref(true);
const visible = ref(true);   // 后台关掉时置 false，整块不渲染
const pool = ref([]);
const total = ref(0);
const cursor = ref(0);
const preview = ref(null);

let timer = null;

/** 循环取窗口：池子不足 5 张就直接全显示，不重复 */
const shown = computed(() => {
  const p = pool.value;
  if (p.length <= PER_PAGE) return p;
  return Array.from({ length: PER_PAGE }, (_, i) => p[(cursor.value + i) % p.length]);
});

/** 照片不足 5 张时收拢列数（1~4 张就 1~4 列），让这一行铺满、不留空位；>=5 张固定 5 列 */
const wallCols = computed(() => Math.min(Math.max(pool.value.length, 1), PER_PAGE));

function start() {
  stop();
  if (pool.value.length <= PER_PAGE) return;
  timer = setInterval(() => {
    if (document.hidden) return;
    cursor.value = (cursor.value + PER_PAGE) % pool.value.length;
  }, ROTATE_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

onMounted(async () => {
  try {
    const data = await api.gallery(30);
    pool.value = data.items || [];
    total.value = Number(data.total) || pool.value.length;
    start();
  } catch (e) {
    if (e.code === 'GALLERY_CLOSED' || e.status === 403) visible.value = false;
    else toastErr(e.message); // 照片墙加载失败不该挡住首页，提示一下即可
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(stop);
</script>

<style scoped>
.wall {
  display: grid;
  /* 列数由 --wall-cols 控制（照片少时收拢铺满整行）；窄屏媒体查询优先级更高，保持 3/2 列 */
  grid-template-columns: repeat(var(--wall-cols, 5), 1fr);
  gap: var(--spacing-16);
}
@media (max-width: 900px) { .wall { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 560px) { .wall { grid-template-columns: repeat(2, 1fr); gap: 12px; } }

.wall__item { display: flex; flex-direction: column; gap: 8px; cursor: pointer; }
.wall__frame {
  width: 100%;
  aspect-ratio: 4 / 5;
  /* 列数收拢后卡片会变宽，限一下高度防止 1~2 张时变成巨型竖图；照片 cover 铺满裁切 */
  max-height: 460px;
  overflow: hidden;
  background: var(--color-paper-mist);
  border: 1px solid var(--color-ash);
  border-radius: var(--radius-cards);
}
.wall__frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  /* 换一批时轻微淡入，别让图片"啪"地跳一下 */
  animation: wallIn .45s ease both;
}
@keyframes wallIn {
  from { opacity: 0; transform: scale(1.015); }
  to { opacity: 1; transform: none; }
}

.wall__cap { display: flex; align-items: center; gap: 6px; min-width: 0; }
.wall__dot { width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0; }
.wall__theme { font-size: var(--text-body-sm); font-weight: 600; color: var(--color-charcoal); flex-shrink: 0; }
.wall__who {
  font-size: var(--text-caption);
  color: var(--color-fog);
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .wall__frame img { animation: none; }
}
</style>
