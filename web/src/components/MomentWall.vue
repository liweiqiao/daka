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
      <div v-if="loading" class="carousel" style="margin-top: 32px">
        <div class="o-skel" style="aspect-ratio: 4 / 5; max-height: 480px"></div>
      </div>

      <!-- 还没有照片（活动没开始、或刚开始还没人交）：说清楚，别让人以为墙坏了 -->
      <div v-else-if="!pool.length" class="o-card o-card--pad-lg" style="margin-top: 32px; text-align: center">
        <div class="o-label">还没有照片</div>
        <p class="o-text-sm o-text-muted" style="margin-top: 8px; line-height: 1.8">
          第一个完成打卡的孩子，照片就会出现在这里。
        </p>
      </div>

      <template v-else>
        <!-- 单卡片轮播：手机上左右滑动翻看，桌面端用两侧箭头；每 6 秒自动换下一张 -->
        <div
          class="carousel"
          style="margin-top: 32px"
          @pointerdown="userGrab"
          @wheel="userGrab"
        >
          <div ref="trackEl" class="carousel__track" @scroll.passive="onScroll">
            <figure
              v-for="p in pool"
              :key="p.key"
              class="carousel__item"
              @click="preview = p"
            >
              <div class="carousel__frame">
                <img :src="p.url" alt="" loading="lazy" />
              </div>
              <figcaption class="carousel__cap">
                <span class="carousel__themecolor" :style="{ background: themeColor(p.theme) }"></span>
                <span class="carousel__theme">{{ p.theme }}</span>
                <span class="carousel__who">{{ p.name }}</span>
              </figcaption>
            </figure>
          </div>

          <!-- 桌面端左右箭头（触屏设备隐藏，靠滑动） -->
          <button v-if="pool.length > 1" class="carousel__nav carousel__nav--prev" type="button" aria-label="上一张" @click.stop="go(index - 1)">‹</button>
          <button v-if="pool.length > 1" class="carousel__nav carousel__nav--next" type="button" aria-label="下一张" @click.stop="go(index + 1)">›</button>
        </div>

        <p v-if="pool.length > 1" class="o-text-caption o-text-muted" style="text-align: center; margin-top: 14px">
          {{ index + 1 }} / {{ pool.length }} · 左右滑动看更多 · 点开可以看大图
        </p>
        <p v-else class="o-text-caption o-text-muted" style="text-align: center; margin-top: 14px">
          点开可以看大图
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
 * 交互（2026-09-16 由 5 卡网格改成单卡片轮播，手机上 5 列太挤）：
 *   - 一次只展示一张卡片，横向 scroll-snap 轨道：手机上直接滑动翻页，
 *     桌面端有左右箭头；每 6 秒自动切下一张。
 *   - 用户一旦手动滑动/点击，自动轮播暂停 10 秒再续，避免跟人抢。
 *   - 数据来自 /api/gallery，后端已做去重（一个孩子一次只占一个位置）
 *     和姓名脱敏，这里只负责展示。
 *   - 后台把 gallery_public 关掉时接口回 403，整块直接不渲染。
 *   - 页面切到后台就停掉定时器；家长在微信里挂着不看的页面不该一直转。
 */
import { onMounted, onBeforeUnmount, ref } from 'vue';
import Modal from './Modal.vue';
import { api } from '../api.js';
import { themeColor, mdText } from '../utils.js';
import { toastErr } from '../toast.js';

const ROTATE_SEC = 6;
const USER_PAUSE_MS = 10000;   // 用户动过之后，自动轮播歇一会儿再续

const loading = ref(true);
const visible = ref(true);   // 后台关掉时置 false，整块不渲染
const pool = ref([]);
const total = ref(0);
const preview = ref(null);

const trackEl = ref(null);
const index = ref(0);

let timer = null;
let lastUserAt = 0;      // 最近一次用户操作的时刻
let programmaticAt = 0;  // 最近一次程序驱动滚动的时刻（区分自动翻页和手滑）

function userGrab() { lastUserAt = Date.now(); }

/** 翻到第 i 张（自动取模循环）；user=true 表示人主动点的，自动轮播要让路 */
function go(i, { user = true } = {}) {
  const el = trackEl.value;
  const n = pool.value.length;
  if (!el || !n) return;
  const target = ((i % n) + n) % n;
  programmaticAt = Date.now();
  el.scrollTo({ left: target * el.clientWidth, behavior: 'smooth' });
  index.value = target;
  if (user) lastUserAt = Date.now();
}

function onScroll() {
  const el = trackEl.value;
  if (!el || !el.clientWidth) return;
  // 非程序驱动的滚动（= 用户在用手滑）：刷新用户操作时刻，让自动轮播先歇着
  if (Date.now() - programmaticAt > 700) lastUserAt = Date.now();
  const i = Math.round(el.scrollLeft / el.clientWidth);
  if (i !== index.value) index.value = i;
}

function start() {
  stop();
  if (pool.value.length <= 1) return;
  timer = setInterval(() => {
    if (document.hidden) return;
    if (Date.now() - lastUserAt < USER_PAUSE_MS) return;
    go(index.value + 1, { user: false });
  }, ROTATE_SEC * 1000);
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
.carousel {
  position: relative;
  /* 桌面端别让一张照片横跨整个宽容器：收成"照片卡"的样子居中 */
  max-width: 520px;
  margin-left: auto;
  margin-right: auto;
}
@media (max-width: 640px) { .carousel { max-width: none; } }

.carousel__track {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  /* 项目之间不留缝（每张正好占满轨道宽，scrollLeft = i * clientWidth 才对得上） */
  scrollbar-width: none;
}
.carousel__track::-webkit-scrollbar { display: none; }

.carousel__item {
  flex: 0 0 100%;
  scroll-snap-align: center;
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  min-width: 0;
}
.carousel__frame {
  width: 100%;
  aspect-ratio: 4 / 5;
  max-height: 480px;
  overflow: hidden;
  background: var(--color-paper-mist);
  border: 1px solid var(--color-ash);
  border-radius: var(--radius-cards);
}
.carousel__frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.carousel__cap { display: flex; align-items: center; gap: 6px; min-width: 0; }
.carousel__themecolor { width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0; }
.carousel__theme { font-size: var(--text-body-sm); font-weight: 600; color: var(--color-charcoal); flex-shrink: 0; }
.carousel__who {
  font-size: var(--text-caption);
  color: var(--color-fog);
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 桌面端箭头：悬浮在卡片两侧；触屏设备（hover:none）隐藏，靠滑动 */
.carousel__nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  border-radius: 999px;
  border: 1px solid var(--color-ash);
  background: rgba(255, 255, 255, 0.94);
  color: var(--color-charcoal);
  font-size: 22px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.10);
  z-index: 2;
}
.carousel__nav--prev { left: -14px; }
.carousel__nav--next { right: -14px; }
.carousel__nav:active { transform: translateY(-50%) scale(0.96); }
@media (hover: none) {
  .carousel__nav { display: none; }
}
</style>
