<template>
  <ParticipantShell>
    <section class="o-section" style="flex: 1">
      <div class="o-container">
        <div class="o-eyebrow">LIVE BOARD</div>
        <h1 class="o-h2">打卡战报</h1>
        <p class="o-text-muted o-text-sm" style="margin-top: 10px">
          数据实时更新。排行榜只显示脱敏姓名，用于鼓励，不做排名评比。
        </p>

        <div v-if="closed" class="o-card o-card--pad-lg" style="margin-top: 24px; text-align: center">
          <h2 class="o-h2">战报暂未开放</h2>
          <p class="o-text-muted o-text-sm" style="margin-top: 12px">活动方还没有公开实时战报。</p>
        </div>

        <div v-else-if="loading" class="o-kpis" style="margin-top: 28px">
          <div v-for="i in 4" :key="i" class="o-skel" style="height: 96px"></div>
        </div>

        <template v-else>
          <div class="o-kpis" style="margin-top: 28px">
            <div class="o-kpi">
              <div class="o-kpi__label">累计打卡次数</div>
              <div class="o-kpi__value">{{ num(board.total.checkins) }}</div>
              <div class="o-kpi__sub">每完成 1 项算 1 次</div>
            </div>
            <div class="o-kpi">
              <div class="o-kpi__label">累计打卡人数</div>
              <div class="o-kpi__value">{{ num(board.total.people) }}</div>
              <div class="o-kpi__sub">至少完成过 1 次</div>
            </div>
            <div class="o-kpi">
              <div class="o-kpi__label">今日打卡</div>
              <div class="o-kpi__value">{{ num(board.today.checkins) }}</div>
              <div class="o-kpi__sub">{{ num(board.today.people) }} 人参与</div>
            </div>
            <div class="o-kpi">
              <div class="o-kpi__label">人均打卡</div>
              <div class="o-kpi__value">{{ board.total.avgPerPerson }}<span class="unit">次</span></div>
              <div class="o-kpi__sub">按活动 {{ board.total.days }} 天计</div>
            </div>
          </div>

          <!-- 今日最多 / 最少：活动方最关心的两个数，直接放最上面 -->
          <div class="ml-grid">
            <div class="o-card">
              <div class="o-badge o-badge--success">今日最多</div>
              <div class="ml-list">
                <div v-for="m in board.today.max" :key="m.taskId" class="ml-item">
                  <span class="o-task__theme" style="font-size: 11px">{{ m.theme }}</span>
                  <span class="ml-name">{{ m.taskName }}</span>
                  <span class="ml-num">{{ m.count }}<i>人</i></span>
                </div>
              </div>
            </div>
            <div class="o-card">
              <div class="o-badge o-badge--warn">今日最少</div>
              <div class="ml-list">
                <div v-for="m in board.today.min" :key="m.taskId" class="ml-item">
                  <span class="o-task__theme" style="font-size: 11px">{{ m.theme }}</span>
                  <span class="ml-name">{{ m.taskName }}</span>
                  <span class="ml-num">{{ m.count }}<i>人</i></span>
                </div>
              </div>
            </div>
          </div>

          <!-- 今日七项分布 -->
          <div class="o-card o-card--pad-lg" style="margin-top: 24px">
            <div class="o-label" style="margin-bottom: 4px">今天各主题完成情况</div>
            <p class="o-text-caption o-text-muted" style="margin-bottom: 20px">
              每根条代表一项任务，长度按今天的打卡人数算
            </p>
            <div class="bars">
              <div v-for="t in sortedTasks" :key="t.taskId" class="bar">
                <div class="bar__head">
                  <span class="bar__dot" :style="{ background: themeColor(t.theme) }"></span>
                  <span class="bar__theme">{{ t.theme }}</span>
                  <span class="bar__name">{{ t.taskName }}</span>
                  <span class="bar__num">{{ t.count }}</span>
                </div>
                <div class="bar__track">
                  <div class="bar__fill" :style="{ width: barWidth(t.count), background: themeColor(t.theme) }"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- 每日趋势 -->
          <div class="o-card o-card--pad-lg" style="margin-top: 24px">
            <div class="o-label" style="margin-bottom: 4px">每日趋势</div>
            <p class="o-text-caption o-text-muted" style="margin-bottom: 16px">
              深色是打卡次数，浅色是同一天的人数
            </p>
            <svg :viewBox="`0 0 ${chartW} ${chartH}`" class="trend" preserveAspectRatio="none">
              <line
                v-for="(g, i) in gridLines"
                :key="'g' + i"
                :x1="padL" :x2="chartW - padR"
                :y1="g.y" :y2="g.y"
                stroke="#efe9ef" stroke-width="1"
              />
              <g v-for="(p, i) in points" :key="'b' + i">
                <rect
                  :x="p.x - 13" :y="p.ypeople" width="26"
                  :height="Math.max(0, chartH - padB - p.ypeople)"
                  rx="4" fill="#d4ccd4"
                />
                <!-- 前面的柱子是"打卡次数"。今天用结构墨色 #240029，
                     其余天用 Heather #6d526d —— 深浅区分而不是换色相，
                     热粉在这里属于违规（它不是 CTA）。 -->
                <rect
                  :x="p.x - 13" :y="p.y" width="26"
                  :height="Math.max(0, chartH - padB - p.y)"
                  rx="4" :fill="p.isToday ? '#240029' : '#6d526d'"
                />
                <text
                  :x="p.x" :y="chartH - 8" text-anchor="middle" class="axis"
                  :style="{ fontWeight: p.isToday ? 700 : 400 }"
                >{{ p.label }}</text>
                <text :x="p.x" :y="p.y - 7" text-anchor="middle" class="val">{{ p.checkins }}</text>
              </g>
            </svg>
          </div>

          <!-- 打卡榜 -->
          <div class="o-card o-card--pad-lg" style="margin-top: 24px">
            <div class="o-label" style="margin-bottom: 4px">打卡次数榜（前 20 名）</div>
            <p class="o-text-caption o-text-muted" style="margin-bottom: 16px">
              姓名已脱敏，仅作鼓励，不是评比
            </p>
            <div v-if="!board.top.length" class="o-empty" style="padding: 24px 0">还没有数据</div>
            <ol v-else class="rank">
              <li v-for="p in board.top" :key="p.rank" class="rank__item">
                <span class="rank__no" :class="{ 'rank__no--top': p.rank <= 3 }">{{ p.rank }}</span>
                <span class="rank__name">{{ p.name }}</span>
                <span class="rank__school o-text-caption o-text-muted">{{ p.school }}</span>
                <span class="rank__num">{{ p.total }}</span>
              </li>
            </ol>
          </div>

          <p class="o-text-caption o-text-muted" style="margin-top: 20px; text-align: right">
            数据生成时间：{{ board.generatedAt }}
          </p>
        </template>
      </div>
    </section>
  </ParticipantShell>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import ParticipantShell from '../components/ParticipantShell.vue';
import { api } from '../api.js';
import { themeColor, mdText } from '../utils.js';
import { toastErr } from '../toast.js';

const loading = ref(true);
const closed = ref(false);
const board = ref({
  total: { checkins: 0, people: 0, days: 7, avgPerPerson: 0 },
  today: { checkins: 0, people: 0, max: [], min: [], tasks: [] },
  trend: [],
  top: [],
  generatedAt: '',
});

const sortedTasks = computed(() => [...(board.value.today.tasks || [])].sort((a, b) => b.count - a.count));
const maxCount = computed(() => Math.max(1, ...sortedTasks.value.map((t) => t.count), 1));

function barWidth(n) { return `${Math.max(2, (n / maxCount.value) * 100)}%`; }

// ---- 趋势图几何 ----
const chartW = 700;
const chartH = 220;
const padL = 24;
const padR = 24;
const padB = 30;
const padT = 24;

const maxTrend = computed(() => {
  const m = Math.max(1, ...board.value.trend.flatMap((d) => [d.checkins, d.people]));
  return Math.ceil(m * 1.15);
});

const points = computed(() => {
  const list = board.value.trend || [];
  if (!list.length) return [];
  const inner = chartW - padL - padR;
  const step = inner / list.length;
  const usable = chartH - padB - padT;
  const yOf = (v) => chartH - padB - (v / maxTrend.value) * usable;
  return list.map((d, i) => ({
    x: padL + step * i + step / 2,
    y: yOf(d.checkins),
    ypeople: yOf(d.people),
    checkins: d.checkins,
    label: mdText(d.date),
    isToday: d.isToday,
  }));
});

const gridLines = computed(() => [0, 0.25, 0.5, 0.75, 1].map((r) => ({
  y: padT + (chartH - padB - padT) * r,
})));

function num(n) { return Number(n || 0).toLocaleString('zh-CN'); }

onMounted(async () => {
  try {
    board.value = await api.board();
  } catch (e) {
    if (e.code === 'BOARD_CLOSED' || e.status === 403) closed.value = true;
    else toastErr(e.message);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.unit { font-size: 14px; font-weight: 600; margin-left: 3px; }

.ml-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
@media (max-width: 640px) { .ml-grid { grid-template-columns: 1fr; } }

.ml-list { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
.ml-item { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ml-name { font-size: 15px; font-weight: 600; }
.ml-num { margin-left: auto; font-size: 18px; font-weight: 700; }
.ml-num i { font-size: 12px; font-weight: 500; font-style: normal; color: var(--color-heather); margin-left: 2px; }

.bars { display: flex; flex-direction: column; gap: 14px; }
.bar__head { display: flex; align-items: center; gap: 8px; font-size: 14px; margin-bottom: 6px; }
.bar__dot { width: 8px; height: 8px; border-radius: 99px; flex-shrink: 0; }
.bar__theme { font-weight: 700; }
.bar__name { color: var(--color-heather); }
.bar__num { margin-left: auto; font-weight: 700; font-variant-numeric: tabular-nums; }
.bar__track { height: 10px; background: #f7f4f7; border-radius: 99px; overflow: hidden; }
.bar__fill { height: 100%; border-radius: 99px; transition: width .5s ease; }

.trend { width: 100%; height: auto; min-width: 560px; }
.axis { font-size: 11px; fill: var(--color-heather); }
.val { font-size: 11px; font-weight: 700; fill: var(--color-aubergine); }

.rank { display: flex; flex-direction: column; }
.rank__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #f4f0f4;
}
.rank__item:last-child { border-bottom: none; }
.rank__no {
  width: 24px; height: 24px;
  border-radius: 999px;
  background: #f4f0f4;
  color: var(--color-heather);
  font-size: 12px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.rank__no--top { background: var(--color-aubergine); color: #fff; }
.rank__name { font-weight: 600; font-size: 15px; }
.rank__school { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rank__num { font-weight: 700; font-variant-numeric: tabular-nums; }
</style>
