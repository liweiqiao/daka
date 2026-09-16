<template>
  <div style="display: flex; flex-direction: column; gap: 28px">
    <!-- 日期与导出 -->
    <Card :body-style="{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }">
      <div class="pp-field" style="flex-direction: row; align-items: center; gap: 10px">
        <label class="pp-label" for="d-date" style="white-space: nowrap">查看日期</label>
        <DatePicker id="d-date" v-model:value="date" value-format="YYYY-MM-DD" size="small" @change="onDate" />
      </div>
      <Tag checkable :checked="isToday" @change="onBackToday">回到今天</Tag>
      <Tag v-if="overview" class="dub-tag--blue">
        活动第 {{ overview.activity.dayIndex }} / {{ overview.activity.totalDays }} 天
      </Tag>

      <div class="pp-spacer"></div>

      <div style="display: flex; gap: 8px; flex-wrap: wrap">
        <Button size="small" :disabled="busy" @click="refresh">刷新</Button>
        <Button size="small" :disabled="busy" @click="exportCsv('checkins')">导出打卡明细</Button>
        <Button type="primary" size="small" :disabled="busy" @click="exportCsv('participants')">导出参与者</Button>
      </div>
    </Card>

    <!-- 核心 KPI -->
    <div v-if="!data" class="pp-grid pp-grid--4">
      <div v-for="i in 4" :key="i" class="pp-skel" style="height: 132px"></div>
    </div>

    <template v-else>
      <div class="pp-grid pp-grid--4">
        <Card class="dub-kpi dub-kpi--brand" :body-style="{ padding: '0' }">
          <div class="dub-kpi__label">累计打卡次数</div>
          <div class="dub-kpi__value">{{ n(ov.totalCheckins) }}</div>
          <div class="dub-kpi__foot">每完成 1 项任务算 1 次</div>
        </Card>
        <Card class="dub-kpi" :body-style="{ padding: '0' }">
          <div class="dub-kpi__label">累计打卡人数</div>
          <div class="dub-kpi__value">{{ n(ov.totalPeople) }}</div>
          <div class="dub-kpi__foot">至少完成过 1 次</div>
        </Card>
        <Card class="dub-kpi" :body-style="{ padding: '0' }">
          <div class="dub-kpi__label">{{ isToday ? '今日' : selDate + ' 当日' }}打卡次数</div>
          <div class="dub-kpi__value">{{ n(ov.today.checkins) }}</div>
          <div class="dub-kpi__foot">{{ n(ov.today.people) }} 人参与 · {{ n(ov.today.batches) }} 次提交</div>
        </Card>
        <Card class="dub-kpi dub-kpi--dark" :body-style="{ padding: '0' }">
          <div class="dub-kpi__label">人均打卡</div>
          <div class="dub-kpi__value">{{ ov.avgPerPerson }}<span class="dub-kpi__unit">次</span></div>
          <div class="dub-kpi__foot">{{ ov.totalDays }} 天累计，满勤约 {{ ov.activity.totalDays * 7 }} 次</div>
        </Card>
      </div>

      <!-- 漏斗 + 荣誉达标 -->
      <div class="pp-chartgrid pp-chartgrid--2">
        <Card class="pp-chartcard">
          <div class="pp-chartcard__head">
            <h2 class="pp-h3">参与漏斗</h2>
            <span class="pp-caption">每一层都是去重后的人数</span>
          </div>
          <PPChart
            :option="funnelOpt"
            :height="280"
            :empty="!funnelData.stages || !funnelData.stages.length"
            empty-text="还没有参与数据"
          />
          <div v-if="funnelData.stages && funnelData.stages.length" class="pp-legend" style="margin-top: 16px">
            <span v-for="s in funnelData.stages" :key="s.key" class="pp-legend__item">
              {{ s.name }}：<b>{{ n(s.people) }}</b> 人
              <span class="pp-caption">（上一层留存 {{ s.rateFromPrev }}%）</span>
            </span>
          </div>
        </Card>

        <Card class="pp-chartcard">
          <div class="pp-chartcard__head">
            <h2 class="pp-h3">荣誉达标</h2>
            <span class="pp-caption">门槛可在活动设置里改</span>
          </div>
          <PPChart
            :option="honorOpt"
            :height="280"
            :empty="honorEmpty"
            empty-text="还没有人达标"
          />
        </Card>
      </div>

      <!-- 七天趋势 -->
      <Card class="pp-chartcard">
        <div class="pp-chartcard__head">
          <h2 class="pp-h3">七天趋势</h2>
          <span class="pp-chartcard__note">柱＝打卡次数（左轴），线＝参与人数与提交批次（右轴）</span>
        </div>
        <PPChart :option="trendOpt" :height="300" :empty="!trend.length" empty-text="活动还没开始" />
      </Card>

      <!-- 提交时段 -->
      <Card class="pp-chartcard">
        <div class="pp-chartcard__head">
          <h2 class="pp-h3">提交时段分布</h2>
          <span class="pp-chartcard__note">按提交批次计。峰值是提醒的最佳发送时间</span>
          <div v-if="hourlyData.peakHour !== null" class="pp-chartcard__right">
            <Tag class="dub-tag--new">
              峰值 {{ String(hourlyData.peakHour).padStart(2, '0') }}:00 · {{ n(hourlyData.peakBatches) }} 次
            </Tag>
          </div>
        </div>
        <PPChart
          :option="hourlyOpt"
          :height="240"
          :empty="!hourlyData.total"
          empty-text="还没有提交记录"
        />
      </Card>

      <!-- 热力图 + 七主题 -->
      <div class="pp-chartgrid pp-chartgrid--2">
        <Card class="pp-chartcard">
          <div class="pp-chartcard__head">
            <h2 class="pp-h3">日期 × 主题</h2>
            <span class="pp-caption">颜色越深打卡越集中</span>
          </div>
          <div class="pp-chart pp-chart--scroll">
            <PPChart :option="heatmapOpt" :height="320" :empty="!matrix.cells || !matrix.cells.length" />
          </div>
        </Card>

        <Card class="pp-chartcard">
          <div class="pp-chartcard__head">
            <h2 class="pp-h3">七主题分布</h2>
            <span class="pp-caption">看哪个主题参与了最少</span>
          </div>
          <PPChart :option="radarOpt" :height="320" :empty="!matrix.byTheme || !matrix.byTheme.length" />
        </Card>
      </div>

      <!-- 学校排行 -->
      <Card class="pp-chartcard">
        <div class="pp-chartcard__head">
          <h2 class="pp-h3">学校排行</h2>
          <span class="pp-chartcard__note">按打卡次数，取前 10，颜色越深名次越高</span>
        </div>
        <PPChart :option="schoolOpt" :height="380" :empty="!data.schools.length" empty-text="还没有数据" />
      </Card>

      <!-- 当日项目冷热 -->
      <div>
        <div class="pp-section-head">
          <h2 class="pp-h2">当日项目冷热</h2>
          <span class="pp-caption">活动方最关心的两个数：哪个项目人最多、哪个最少</span>
        </div>
        <div class="pp-grid pp-grid--2" style="margin-bottom: 16px">
          <Card :body-style="{ padding: '20px' }">
            <div class="pp-row" style="margin-bottom: 12px">
              <Tag class="dub-tag--new">打卡最多</Tag>
              <span class="pp-caption">{{ daily.weekday }} · 共 {{ n(daily.checkins) }} 次</span>
            </div>
            <div v-if="!daily.max.length" class="pp-empty" style="padding: 16px 0">当天还没有打卡记录</div>
            <div v-else class="pp-hot">
              <div v-for="t in daily.max" :key="t.taskId" class="pp-hot__item">
                <Tag :style="themeTagStyle(t.theme)">{{ t.theme }}</Tag>
                <span class="pp-hot__name">{{ t.taskName }}</span>
                <span class="pp-hot__num">{{ t.count }} 人 · {{ t.people }} 人次</span>
              </div>
            </div>
          </Card>

          <Card :body-style="{ padding: '20px' }">
            <div class="pp-row" style="margin-bottom: 12px">
              <Tag>打卡最少</Tag>
              <span class="pp-caption">{{ daily.weekday }} · 需要留意推广力度</span>
            </div>
            <div v-if="!daily.min.length" class="pp-empty" style="padding: 16px 0">当天还没有打卡记录</div>
            <div v-else class="pp-hot">
              <div v-for="t in daily.min" :key="t.taskId" class="pp-hot__item">
                <Tag :style="themeTagStyle(t.theme)">{{ t.theme }}</Tag>
                <span class="pp-hot__name">{{ t.taskName }}</span>
                <span class="pp-hot__num">{{ t.count }} 人</span>
              </div>
            </div>
          </Card>
        </div>

        <Card class="pp-chartcard">
          <div class="pp-chartcard__head">
            <h2 class="pp-h3">当天七项任务完成情况</h2>
            <span class="pp-caption">{{ selDate }} {{ daily.weekday }}</span>
            <span class="pp-chartcard__note">条形长度按完成人数，线下打卡点用浅灰单独标出</span>
          </div>
          <PPChart :option="dailyOpt" :height="300" :empty="!daily.tasks.length" empty-text="这一天没有任务" />
        </Card>
      </div>

      <!-- 参与深度 + 资源占用 -->
      <div class="pp-chartgrid pp-chartgrid--3">
        <Card class="pp-chartcard">
          <div class="pp-chartcard__head">
            <h2 class="pp-h3">打卡天数分布</h2>
          </div>
          <PPChart :option="dayDistOpt" :height="240" :empty="!distData.length" />
          <p class="pp-caption" style="margin-top: 12px">黄色是打满全程的人，衡量活动粘性就看他</p>
        </Card>

        <Card class="pp-chartcard">
          <div class="pp-chartcard__head">
            <h2 class="pp-h3">主题覆盖分布</h2>
          </div>
          <PPChart :option="coverageOpt" :height="240" :empty="!coverData.length" />
          <p class="pp-caption" style="margin-top: 12px">覆盖 7 个主题的即「全能少年」候选</p>
        </Card>

        <Card :body-style="{ padding: '20px' }">
          <h2 class="pp-h3" style="margin-bottom: 16px">资源占用</h2>
          <div class="res">
            <div class="res__row"><span>照片</span><b>{{ n(ov.media.photos) }} 张</b></div>
            <div class="res__row"><span>视频</span><b>{{ n(ov.media.videos) }} 段</b></div>
            <div class="res__row"><span>已占用空间</span><b>{{ ov.media.totalMB }} MB</b></div>
            <div class="res__row"><span>线下打卡点记录</span><b>{{ n(ov.offlineCheckins) }} 次</b></div>
            <div class="res__row" style="border-top: 1px solid var(--dub-line); padding-top: 12px; margin-top: 4px">
              <span>已登记未打卡</span>
              <b>{{ n(ov.idlePeople) }} 人</b>
              <span v-if="ov.idlePeople > 0" class="dub-tag--warn">待催</span>
            </div>
            <div class="res__row">
              <span>待清理的孤儿文件</span>
              <b>{{ n(ov.pendingMedia) }} 个</b>
            </div>
          </div>
          <router-link to="/admin/media" custom v-slot="{ navigate }">
            <Button size="small" block style="margin-top: 16px" @click="navigate">去附件页清理</Button>
          </router-link>
        </Card>
      </div>

      <!-- 重名提醒 -->
      <Card v-if="data.duplicates.length">
        <div class="pp-section-head">
          <h2 class="pp-h3">重名提醒</h2>
          <Tag class="dub-tag--warn">{{ data.duplicates.length }} 组需要确认</Tag>
        </div>
        <p class="pp-lead" style="margin-bottom: 16px">
          名字相同、学校相同、手机号也相同 —— 大概率是同一个人被重复登记了两遍，建议核对后合并。
        </p>
        <Table
          :columns="dupColumns"
          :data-source="data.duplicates"
          :pagination="false"
          row-key="name"
          size="middle"
          :scroll="{ x: 720 }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'">
              <span style="font-weight: 600">{{ record.name }}</span>
            </template>
            <template v-else-if="column.key === 'school'">
              {{ record.people[0] && record.people[0].school }}
            </template>
            <template v-else-if="column.key === 'totals'">
              {{ record.people.map((p) => p.total).join(' / ') }}
            </template>
            <template v-else-if="column.key === 'action'">
              <router-link :to="`/admin/participants?keyword=${encodeURIComponent(record.name)}`" custom v-slot="{ navigate }">
                <Button type="link" size="small" @click="navigate">去核对</Button>
              </router-link>
            </template>
          </template>
        </Table>
      </Card>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { Table, Card, Button, DatePicker, Tag } from 'ant-design-vue';
import PPChart from '../../components/PPChart.vue';
import { adminApi, download } from '../../api.js';
import { THEME_COLORS } from '../../utils.js';
import { toastOk, toastErr } from '../../toast.js';
import {
  trendOption,
  heatmapOption,
  themeRadarOption,
  dailyTaskOption,
  dayDistOption,
  themeCoverageOption,
  schoolRankOption,
  funnelOption,
  honorDonutOption,
  hourlyOption,
} from '../../charts/options.js';

const data = ref(null);
const date = ref('');
const busy = ref(false);

const ov = computed(() => (data.value ? data.value.overview : {}));
const daily = computed(() => (data.value ? data.value.daily : { tasks: [], max: [], min: [], weekday: '' }));
const matrix = computed(() => (data.value ? data.value.matrix : { themes: [], dates: [], cells: [], byTheme: [] }));
const trend = computed(() => (data.value ? data.value.trend : []));
const distData = computed(() => (data.value ? data.value.dayDistribution.dist : []));
const coverData = computed(() => (data.value ? data.value.themeCoverage : []));
const hourlyData = computed(() => (data.value ? data.value.hourly : { hours: [], total: 0, peakHour: null, peakBatches: 0 }));
const funnelData = computed(() => (data.value ? data.value.funnel : { stages: [] }));
const honorData = computed(() => (data.value ? data.value.honors : { honors: [] }));

const isToday = computed(() => date.value === ov.value.date || (!date.value && true));
const selDate = computed(() => ov.value.date || '');

const honorEmpty = computed(() => (honorData.value.honors || []).every((h) => Number(h.count) === 0));

// 每个图表都是纯函数算出来的，数据变就重算。放在这里只是为了让模板干净，
// 真正的逻辑在 charts/options.js（那边可以单独被验收脚本断言）
const trendOpt = computed(() => trendOption(trend.value));
const heatmapOpt = computed(() => heatmapOption(matrix.value));
const radarOpt = computed(() => themeRadarOption(matrix.value));
const dailyOpt = computed(() => dailyTaskOption(daily.value));
const dayDistOpt = computed(() => dayDistOption(distData.value, ov.value.activity ? ov.value.activity.totalDays : 7));
const coverageOpt = computed(() => themeCoverageOption(coverData.value));
const schoolOpt = computed(() => schoolRankOption(data.value ? data.value.schools : [], 10));
const funnelOpt = computed(() => funnelOption(funnelData.value));
const honorOpt = computed(() => honorDonutOption(honorData.value));
const hourlyOpt = computed(() => hourlyOption(hourlyData.value));

/** 主题标签的底色：沿用参与者端那套 7 色，但在后台只做小面积的点缀 */
function themeTagStyle(theme) {
  const hex = THEME_COLORS[theme] || '#1d1d1f';
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return { background: `rgba(${r},${g},${b},.12)`, color: hex, fontWeight: 600 };
}

const dupColumns = [
  { title: '姓名', dataIndex: 'name', key: 'name', width: 120 },
  { title: '学校', key: 'school' },
  { title: '登记条数', dataIndex: 'count', key: 'count', align: 'right', width: 110, sorter: (a, b) => a.count - b.count },
  { title: '打卡次数', key: 'totals', align: 'right', width: 140 },
  { title: '处理', key: 'action', width: 110 },
];

function n(v) { return Number(v || 0).toLocaleString('zh-CN'); }

async function refresh() {
  busy.value = true;
  try {
    data.value = await adminApi.dashboard(date.value || undefined);
    if (!date.value) date.value = data.value.overview.date;
  } catch (e) {
    toastErr(e.message);
  } finally {
    busy.value = false;
  }
}

// a-date-picker 的 change 回传 (dayjs, 字符串)；这里只取字符串
function onDate(_d, ds) {
  date.value = ds || '';
  refresh();
}
function onBackToday(checked) {
  if (checked) { date.value = ''; }
  else { date.value = selDate.value; }
  refresh();
}
function pickToday() {
  date.value = '';
  refresh();
}

async function exportCsv(type) {
  busy.value = true;
  try {
    const r = await download(`/api/admin/export/${type}`, {}, `${type}.csv`);
    toastOk(`已导出 ${r.name}`);
  } catch (e) {
    toastErr(e.message);
  } finally {
    busy.value = false;
  }
}

onMounted(refresh);
</script>

<style scoped>
/* 冷热榜：只有文字，不再画 CSS 柱条 —— 长短已经在下面的 ECharts 排行里，
   这里重复画一遍只会让两张卡抢视线 */
.pp-hot { display: flex; flex-direction: column; gap: 10px; }
.pp-hot__item { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 14px; }
.pp-hot__name { font-weight: 600; }
.pp-hot__num { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 600; }

.res { display: flex; flex-direction: column; gap: 10px; font-size: 14px; }
.res__row { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.res__row span { color: #404040; }
.res__row b { margin-left: auto; font-variant-numeric: tabular-nums; }

/* 资源占用里的「待催」小标用 Dub 蓝点缀，不用额外彩色 */
.res__row .dub-tag--warn { margin-left: 0; }
</style>
