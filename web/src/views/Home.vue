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
  </ParticipantShell>
</template>

<script setup>
/**
 * Home.vue —— 参与者端首页。
 *
 * 页面结构（刻意做得很短）：
 *   主画面（标题 + 两个按钮） → 临时公告（后台可关） → 立志瞬间照片墙。
 *
 * 2026-09-16 实测后删掉了下面两块：
 *   ① 七个主题的板块（含「线下打卡点」卡片）—— 主题名和线下点都在打卡页
 *      的任务卡上逐条写着，首页再列一遍是重复，家长滑到一半就迷路了；
 *   ② 打卡说明 / 照片视频须知 / 底部深色收尾 —— 同上，规则在打卡页与上传区
 *      就地提示更有效，首页只留"这里是什么活动 + 怎么进去"。
 */
import { computed, onMounted } from 'vue';
import ParticipantShell from '../components/ParticipantShell.vue';
import MomentWall from '../components/MomentWall.vue';
import { loadActivity, loadMe, state, hasToken } from '../appstate.js';
import { mdText } from '../utils.js';
import { toastErr } from '../toast.js';

const act = computed(() => state.activity || {
  title: '清城少年志 · 国庆七天打卡',
  heroEyebrow: '第四届清城少年志国庆打卡活动',
  heroTitle: '少年有志 · 清城有光',
  subtitle: '', notice: '', dates: [],
});

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
  } catch (e) {
    toastErr(e.message);
  }
});
</script>
