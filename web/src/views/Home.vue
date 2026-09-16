<template>
  <ParticipantShell>
    <!-- Hero：白底编辑式，无渐变、无手绘标注（严格按 DESIGN.md：装饰插画与渐变只用于品牌视觉） -->
    <header class="o-hero">
      <div class="o-container o-container--narrow">
        <div class="o-eyebrow">{{ act.heroEyebrow }}</div>
        <h1 class="o-hero__title">{{ act.heroTitle }}</h1>
        <p class="o-hero__sub">{{ act.subtitle }}</p>

        <div class="o-hero__cta">
          <router-link :to="primaryTo" class="o-btn o-btn--primary o-btn--lg">
            {{ hasToken ? '去打卡' : '开始打卡' }}
          </router-link>
          <router-link to="/records" class="o-btn o-btn--ghost o-btn--lg">我的记录</router-link>
        </div>

        <div v-if="act.dates && act.dates.length" style="margin-top: 24px">
          <span class="o-pill">{{ dateRangeText }} · 共 {{ act.dates.length }} 天</span>
        </div>
      </div>
    </header>

    <!-- 临时公告：后台可随时开/关，用来应对"今天线下点临时改地点"这类情况 -->
    <div v-if="act.notice" class="o-container" style="padding-top: 24px">
      <div class="o-card" style="border-left: 4px solid var(--color-glowstick)">
        <div class="o-label" style="margin-bottom: 6px">临时公告</div>
        <div class="o-text-sm" style="line-height: 1.7">{{ act.notice }}</div>
      </div>
    </div>

    <!-- 清城少年立志瞬间：孩子们自己交上来的照片，一次看 5 张，一直往下滚 -->
    <MomentWall />

    <!-- 七个主题 -->
    <section class="o-section">
      <div class="o-container">
        <div class="o-eyebrow" style="text-align: center">SEVEN THEMES</div>
        <h2 class="o-h2" style="text-align: center">每天七件事，挑一件做就行</h2>
        <p class="o-text-muted o-text-sm" style="text-align: center; margin-top: 12px">
          每天7个主题任务，可以选择一个或多个完成哦<br />
          同一主题一天提交一次即可，重复提交会被过滤哦
        </p>

        <div class="theme-grid">
          <div v-for="t in act.themes" :key="t" class="theme-tile">
            <span class="theme-tile__dot" :style="{ background: themeColor(t) }"></span>
            <span class="theme-tile__name">{{ t }}</span>
          </div>
        </div>

        <div v-if="offlineDays.length" class="o-card" style="margin-top: 32px">
          <div class="o-label">线下打卡点</div>
          <p class="o-text-sm o-text-muted" style="line-height: 1.7; margin-top: 6px">
            有几天会有一项任务需要到现场打卡点完成，其余任务在家做就行：
          </p>
          <div class="offline-list">
            <div v-for="d in offlineDays" :key="d.date" class="offline-item">
              <span class="o-badge o-badge--muted">{{ mdText(d.date) }} {{ d.weekday }}</span>
              <span class="o-text-sm">{{ d.offlinePoint }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 说明与注意事项 -->
    <section class="o-section" style="background: var(--color-paper-mist)">
      <div class="o-container o-container--narrow">
        <div class="o-eyebrow">BEFORE YOU START</div>
        <h2 class="o-h2">打卡说明</h2>

        <div class="o-card" style="margin-top: 24px">
          <p class="o-text-sm" style="line-height: 1.8">{{ act.intro }}</p>
          <hr class="o-hr" />
          <ul class="rules">
            <!-- 视频上限为 0 时不能说「0 段视频」，那读起来像系统坏了。
                 直接改成"本次活动不需要上传视频"，家长在打卡页找不到视频入口时就不会来问。 -->
            <li v-if="act.limits.videoMaxCount > 0">
              照片必传，视频可选；每项最多 {{ act.limits.photoMaxCount }} 张照片、{{ act.limits.videoMaxCount }} 段视频。
            </li>
            <li v-else>
              照片必传；每项最多 {{ act.limits.photoMaxCount }} 张照片。本次活动不需要上传视频。
            </li>
            <li v-if="act.limits.videoMaxCount > 0">
              单张照片不超过 {{ act.limits.photoMaxMB }}MB，单段视频不超过 {{ act.limits.videoMaxMB }}MB、{{ act.limits.videoMaxSec }} 秒。
            </li>
            <li v-else>
              单张照片不超过 {{ act.limits.photoMaxMB }}MB。
            </li>
            <li>同一个主题同一天只能打卡一次，重复提交或没传照片的提交会被自动过滤，不会计入。</li>
            <li>日期以系统时间为准，不能补做前几天或提前做后面几天的任务。</li>
            <li>{{ act.certificateNote }}</li>
          </ul>
        </div>

        <div class="o-card" style="margin-top: 16px; background: var(--color-paper-mist); box-shadow: none; border: 1px solid var(--color-plum-tinted)">
          <div class="o-label">{{ act.limits.videoMaxCount > 0 ? '关于照片和视频' : '关于照片' }}</div>
          <p class="o-text-sm o-text-muted" style="line-height: 1.8; margin-top: 6px">
            凭证仅用于本次活动的核验与成果展示。孩子的照片请避免出现门牌号、身份证、学校门禁卡等敏感信息，
            也尽量不拍其他未同意的孩子。
          </p>
        </div>
      </div>
    </section>

    <!-- 深色收尾 band -->
    <section class="o-dark">
      <div class="o-container o-dark__inner">
        <div>
          <h2 class="o-h2">今天还没打卡？</h2>
          <p class="o-text-muted o-text-sm" style="margin-top: 8px">
            {{ act.inActivity ? (hasToken ? '随时可以去补上今天的这一项。' : '你的每一次坚持，我们都看见啦！') : '活动还没开始，先去看看今天的任务。' }}
          </p>
        </div>
        <router-link :to="primaryTo" class="o-btn o-btn--primary o-btn--lg">
          {{ hasToken ? '去打卡' : '开始打卡' }}
        </router-link>
      </div>
    </section>
  </ParticipantShell>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import ParticipantShell from '../components/ParticipantShell.vue';
import MomentWall from '../components/MomentWall.vue';
import { loadActivity, loadTaskDict, loadMe, state, hasToken } from '../appstate.js';
import { themeColor, mdText } from '../utils.js';
import { toastErr } from '../toast.js';

const act = computed(() => state.activity || {
  title: '清城少年志 · 国庆七天打卡',
  heroEyebrow: '第四届清城少年志国庆打卡活动',
  heroTitle: '少年有志 · 清城有光',
  subtitle: '', intro: '', notice: '', certificateNote: '',
  dates: [], themes: ['专注', '乐观', '希望', '自信', '感恩', '坚韧', '活力'],
  limits: { photoMaxMB: 10, videoMaxMB: 30, videoMaxSec: 90, photoMaxCount: 9, videoMaxCount: 1 },
  honors: { allThemes: 7, themeStar: 3, dakaMaster: 14 },
  inActivity: false,
});

const offlineDays = ref([]);

/**
 * 「去打卡 / 开始打卡」一律去打卡页。
 * 信息没填过的孩子，打卡页里会自己出现那三个输入框；
 * 不再先跳一次 /register —— 少一跳，家长少一次"是不是点错了"的犹豫。
 */
const primaryTo = '/checkin';

const dateRangeText = computed(() => {
  const d = act.value.dates || [];
  if (!d.length) return '';
  return `${mdText(d[0])} — ${mdText(d[d.length - 1])}`;
});

onMounted(async () => {
  try {
    await loadActivity();
    // token 还在就顺手确认真实登记态，让按钮文案与实际情况一致
    if (hasToken.value) await loadMe();
    const dict = await loadTaskDict();
    offlineDays.value = (dict.days || []).filter((d) => d.offlinePoint);
  } catch (e) {
    toastErr(e.message);
  }
});
</script>

<style scoped>
.theme-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 12px;
  margin-top: 32px;
}
@media (max-width: 900px) { .theme-grid { grid-template-columns: repeat(4, 1fr); } }
@media (max-width: 520px) { .theme-grid { grid-template-columns: repeat(3, 1fr); } }

.theme-tile {
  background: var(--color-canvas);
  border: 1px solid var(--color-ash);
  border-radius: var(--radius-cards);
  box-shadow: none;
  padding: 20px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.theme-tile__dot { width: 10px; height: 10px; border-radius: 999px; }
.theme-tile__name { font-size: 16px; font-weight: 700; color: var(--color-aubergine); }

.offline-list { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
.offline-item { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.rules { display: flex; flex-direction: column; gap: 10px; }
.rules li {
  font-size: var(--text-body-sm);
  line-height: 1.7;
  color: var(--color-aubergine);
  padding-left: 18px;
  position: relative;
}
.rules li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 9px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  /* 圆点是结构墨色的一部分，不走热粉 —— 热粉只归主动作按钮 */
  background: var(--color-aubergine);
}
</style>
