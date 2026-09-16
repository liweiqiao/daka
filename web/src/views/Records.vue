<template>
  <ParticipantShell>
    <section class="o-section" style="flex: 1">
      <div class="o-container">
        <div v-if="!isRegistered" class="o-card o-card--pad-lg" style="text-align: center">
          <h2 class="o-h2">还没有登记</h2>
          <p class="o-text-muted o-text-sm" style="margin-top: 12px">
            填一次信息就能看到自己每天做过什么、完成了多少。
          </p>
          <router-link to="/checkin" class="o-btn o-btn--primary o-btn--lg" style="margin-top: 24px">去填信息</router-link>
        </div>

        <template v-else>
          <div class="o-daybar">
            <div>
              <div class="o-eyebrow" style="margin-bottom: 6px">MY RECORDS</div>
              <h1 class="o-h2">我的打卡记录</h1>
              <p v-if="me" class="o-text-muted o-text-sm" style="margin-top: 8px">
                {{ me.participant.name }} · {{ me.participant.school }}
              </p>
            </div>
            <button class="o-btn o-btn--ghost o-btn--sm no-select" type="button" @click="load(true)" :disabled="loading">
              刷新
            </button>
          </div>

          <!-- 汇总 -->
          <div v-if="progress" class="o-card o-card--pad-lg" style="margin-bottom: 24px">
            <div class="sum-grid">
              <div>
                <div class="o-kpi__label">累计打卡</div>
                <div class="o-kpi__value">{{ progress.total }}<span class="unit">次</span></div>
              </div>
              <div>
                <div class="o-kpi__label">打卡天数</div>
                <div class="o-kpi__value">{{ progress.days }}<span class="unit">天</span></div>
              </div>
              <div>
                <div class="o-kpi__label">覆盖主题</div>
                <div class="o-kpi__value">{{ progress.themesHit }}<span class="unit">/7</span></div>
              </div>
            </div>

            <hr class="o-hr" />

            <div class="o-label">主题进度</div>
            <div class="o-themechips" style="margin-top: 10px">
              <span
                v-for="t in THEMES"
                :key="t"
                class="o-themechip"
                :class="{ 'is-hit': (progress.themeCount[t] || 0) > 0 }"
              >
                {{ t }}{{ progress.themeCount[t] ? ` · ${progress.themeCount[t]}次` : '' }}
              </span>
            </div>

            <template v-if="progress.honors && progress.honors.length">
              <hr class="o-hr" />
              <div class="o-label">已达成荣誉</div>
              <div class="honors" style="margin-top: 10px">
                <div v-for="h in progress.honors" :key="h.key" class="honor">
                  <span class="o-badge o-badge--success">{{ h.name }}</span>
                  <span class="o-text-caption o-text-muted">{{ h.desc }}</span>
                </div>
              </div>
            </template>

            <div v-if="progress.nextHonor" style="margin-top: 16px">
              <div class="o-text-sm">
                <span class="o-text-muted">最近的目标：</span>
                <b>{{ progress.nextHonor.name }}</b>
                <span class="o-text-muted"> —— {{ progress.nextHonor.need }}</span>
              </div>
            </div>
          </div>

          <!-- 记录列表 -->
          <div v-if="loading" style="display: flex; flex-direction: column; gap: 16px">
            <div v-for="i in 2" :key="i" class="o-skel" style="height: 200px"></div>
          </div>

          <div v-else-if="!days.length" class="o-empty">
            <div class="o-empty__icon">📷</div>
            <div>还没有打卡记录</div>
            <router-link to="/checkin" class="o-btn o-btn--primary" style="margin-top: 20px">去打卡</router-link>
          </div>

          <div v-else class="o-rec">
            <div v-for="day in days" :key="day.date" class="o-card">
              <div class="o-rec__day">
                <span class="o-rec__date">{{ mdText(day.date) }}</span>
                <span class="o-text-caption o-text-muted">{{ day.weekday }}</span>
                <span class="o-badge o-badge--muted" style="margin-left: auto">
                  {{ day.count }} 项 · {{ day.photos }} 张照片<span v-if="day.videos"> · {{ day.videos }} 段视频</span>
                </span>
              </div>

              <div v-for="item in day.items" :key="item.checkinId" class="o-rec__item">
                <div style="flex: 1; min-width: 0">
                  <div class="o-task__head" style="margin-bottom: 8px">
                    <span class="o-task__theme">{{ item.theme }}</span>
                    <span v-if="item.isOffline" class="o-badge o-badge--warn">线下打卡点</span>
                    <span class="o-text-caption o-text-muted">{{ hhmm(item.createdAt) }}</span>
                  </div>
                  <div style="font-size: 16px; font-weight: 600">{{ item.taskName }}</div>
                  <div v-if="item.remark" class="o-text-sm o-text-muted" style="margin-top: 6px; line-height: 1.65">
                    {{ item.remark }}
                  </div>

                  <div v-if="item.images.length" class="o-thumbs" style="margin-top: 12px">
                    <button
                      v-for="(img, i) in item.images"
                      :key="img.key"
                      class="o-thumb no-select"
                      type="button"
                      @click="viewer = { list: item.images.map((x) => x.url), index: i }"
                    >
                      <img :src="img.url" :alt="`照片${i + 1}`" loading="lazy" />
                    </button>
                  </div>

                  <div v-if="item.videos.length" class="o-thumbs" style="margin-top: 10px">
                    <a
                      v-for="v in item.videos"
                      :key="v.key"
                      class="o-pill"
                      :href="v.url"
                      target="_blank"
                      rel="noopener"
                    >
                      ▶ 播放视频（{{ fmtBytes(v.size) }}）
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </section>

    <!-- 图片放大查看：用原生 img 而不是组件库，少一个依赖 -->
    <div v-if="viewer" class="viewer" @click="viewer = null">
      <img :src="viewer.list[viewer.index]" alt="查看照片" />
      <div class="viewer__bar" @click.stop>
        <button class="o-btn o-btn--ghost o-btn--sm" type="button" :disabled="viewer.index === 0" @click="viewer.index--">
          上一张
        </button>
        <span class="viewer__count">{{ viewer.index + 1 }} / {{ viewer.list.length }}</span>
        <button
          class="o-btn o-btn--ghost o-btn--sm"
          type="button"
          :disabled="viewer.index >= viewer.list.length - 1"
          @click="viewer.index++"
        >
          下一张
        </button>
      </div>
    </div>
  </ParticipantShell>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import ParticipantShell from '../components/ParticipantShell.vue';
import { api } from '../api.js';
import { state, hasToken, isRegistered, loadMe, loadActivity } from '../appstate.js';
import { THEMES, mdText, hhmm, fmtBytes } from '../utils.js';
import { toastErr } from '../toast.js';

const loading = ref(true);
const days = ref([]);
const viewer = ref(null);

const me = computed(() => state.me);
const progress = computed(() => (state.me && state.me.progress) || null);

async function load(force = false) {
  // 同 Checkin.vue：这里必须看「本地有没有 token」。
  // 用 isRegistered 判断的话，刷新后 state.me 还是 null，会直接不请求、显示空态。
  if (!hasToken.value) { loading.value = false; return; }
  loading.value = true;
  try {
    await loadActivity();
    if (force) await loadMe(true);
    else await loadMe();
    if (!state.me) { loading.value = false; return; } // token 已失效，页面会引导重新登记
    const data = await api.myRecords();
    days.value = data.days || [];
  } catch (e) {
    toastErr(e.message);
  } finally {
    loading.value = false;
  }
}

onMounted(() => load(true));
</script>

<style scoped>
.sum-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}
@media (max-width: 520px) { .sum-grid { grid-template-columns: repeat(3, 1fr); gap: 8px; } }

.unit { font-size: 14px; font-weight: 600; margin-left: 3px; }

.honors { display: flex; flex-direction: column; gap: 8px; }
.honor { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.viewer {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(10, 10, 10, .96);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.viewer img { max-width: 100%; max-height: 76vh; object-fit: contain; border-radius: 6px; }
.viewer__bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 20px;
}
.viewer__bar .o-btn--ghost { border-color: rgba(255, 255, 255, .4); color: #fff; }
.viewer__bar .o-btn--ghost:disabled { opacity: .35; }
.viewer__count { color: #fff; font-size: 14px; }
</style>
