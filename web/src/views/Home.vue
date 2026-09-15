<template>
  <ParticipantShell>
    <!-- Hero：整幅落日渐变 band，全站唯一使用渐变的地方。
         两条手写标注各配一支手绘箭头，分别指向标题和主按钮 ——
         规范要求标注必须"指向一个具体元素"，光有文字就成了漂浮的装饰。 -->
    <header class="o-hero">
      <span class="o-annot o-annot--a">
        7 天，一天一件事
        <svg viewBox="0 0 46 34" fill="none" aria-hidden="true">
          <path d="M5 5c13 1 25 9 28 21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          <path d="M26 21l7 5 2-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <span class="o-annot o-annot--b">
        拍下来就算数
        <svg viewBox="0 0 46 34" fill="none" aria-hidden="true">
          <path d="M5 5c13 1 25 9 28 21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          <path d="M26 21l7 5 2-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>

      <div class="o-container o-container--narrow">
        <div class="o-eyebrow">清城少年志 · 国庆七天</div>
        <h1 class="o-hero__title">{{ act.title }}</h1>
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

    <!-- 怎么玩 -->
    <section class="o-section">
      <div class="o-container">
        <div class="o-eyebrow" style="text-align: center">HOW IT WORKS</div>
        <h2 class="o-h2" style="text-align: center">三步就能打卡，信息只填一次</h2>

        <div class="o-steps" style="margin-top: 40px">
          <div class="o-step">
            <span class="o-step__no">1</span>
            <div>
              <div class="o-step__body">填一次信息</div>
              <div class="o-step__note">姓名、学校、联系方式。联系方式是后期证书发放的凭证，请填准。填一次就够，之后每天不用再填。</div>
            </div>
          </div>
          <div class="o-step">
            <span class="o-step__no">2</span>
            <div>
              <div class="o-step__body">选今天要做的主题</div>
              <div class="o-step__note">可以只挑一个，做完就提交；也可以一次挑好几个，集中上传。同一个主题一天只能打一次卡。</div>
            </div>
          </div>
          <div class="o-step">
            <span class="o-step__no">3</span>
            <div>
              <div class="o-step__body">传照片，完成</div>
              <div class="o-step__note">
                <template v-if="act.limits.videoMaxCount > 0">照片是必须的，视频可传可不传。</template>
                传完点提交，在「我的记录」里随时能翻自己做过什么。
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 七个主题 -->
    <section class="o-section" style="background: #fffdf3">
      <div class="o-container">
        <div class="o-eyebrow" style="text-align: center">SEVEN THEMES</div>
        <h2 class="o-h2" style="text-align: center">每天七件事，挑一件做就行</h2>
        <p class="o-text-muted o-text-sm" style="text-align: center; margin-top: 12px">
          七天里同一个主题可以做多次，但一天只算一次
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

    <!-- 荣誉 -->
    <section class="o-section">
      <div class="o-container">
        <div class="o-eyebrow" style="text-align: center">HONORS</div>
        <h2 class="o-h2" style="text-align: center">三个荣誉，够得着但不容易</h2>

        <div class="honor-grid">
          <div class="o-card o-card--pad-lg">
            <div class="o-badge o-badge--success">全能少年</div>
            <p class="o-text-sm" style="margin-top: 12px; line-height: 1.7">
              {{ act.honors.allThemes }} 个主题，每个至少完成 1 次。
            </p>
          </div>
          <div class="o-card o-card--pad-lg">
            <div class="o-badge o-badge--success">打卡达人</div>
            <p class="o-text-sm" style="margin-top: 12px; line-height: 1.7">
              累计有效打卡满 {{ act.honors.dakaMaster }} 次，不限主题。
            </p>
          </div>
          <div class="o-card o-card--pad-lg">
            <div class="o-badge o-badge--success">主题之星</div>
            <p class="o-text-sm" style="margin-top: 12px; line-height: 1.7">
              同一个主题做满 {{ act.honors.themeStar }} 次。
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- 说明与注意事项 -->
    <section class="o-section" style="background: #fffdf3">
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

        <div class="o-card" style="margin-top: 16px; background: #faf7fa; box-shadow: none; border: 1px solid var(--color-plum-tinted)">
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
            {{ act.inActivity ? (hasToken ? '随时可以去补上今天的这一项。' : '登记一次，之后每天都不用再填信息。') : '活动还没开始，先把信息登记好。' }}
          </p>
        </div>
        <router-link :to="primaryTo" class="o-btn o-btn--primary o-btn--lg">
          {{ hasToken ? '去打卡' : '开始登记' }}
        </router-link>
      </div>
    </section>
  </ParticipantShell>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import ParticipantShell from '../components/ParticipantShell.vue';
import { loadActivity, loadTaskDict, loadMe, state, hasToken } from '../appstate.js';
import { themeColor, mdText } from '../utils.js';
import { toastErr } from '../toast.js';

const act = computed(() => state.activity || {
  title: '清城少年志 · 国庆七天打卡',
  subtitle: '', intro: '', notice: '', certificateNote: '',
  dates: [], themes: ['专注', '乐观', '希望', '自信', '感恩', '坚韧', '活力'],
  limits: { photoMaxMB: 10, videoMaxMB: 30, videoMaxSec: 90, photoMaxCount: 9, videoMaxCount: 1 },
  honors: { allThemes: 7, themeStar: 3, dakaMaster: 14 },
  inActivity: false,
});

const offlineDays = ref([]);

/**
 * 「去打卡 / 开始登记」按本地 token 判断。
 * 不用 isRegistered：那个还要求 state.me 已加载，而首页加载时它还是 null，
 * 会让已经登记过的家长看到"开始登记"，好像白登记了一样。
 */
const primaryTo = computed(() => (hasToken.value ? '/checkin' : '/register'));

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
  border-radius: var(--radius-cards);
  box-shadow: var(--shadow-card);
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

.honor-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-top: 40px;
}
@media (max-width: 760px) { .honor-grid { grid-template-columns: 1fr; } }

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
