<template>
  <div style="display: flex; flex-direction: column; gap: 20px">
    <div class="pp-card pp-card--mist pp-card--pad-sm">
      <div class="pp-row">
        <span class="pp-badge pp-badge--new">只读</span>
        <span class="pp-caption" style="flex: 1; min-width: 240px">
          任务字典是统计口径的基准。每条打卡记录都会把主题名和任务名抄一份快照，
          所以中途改字典会让老数据对不上 —— 因此这里只展示，不开放编辑。
          确需改动请直接改 <code class="pp-mono">server/db/tasks-data.js</code> 后重跑
          <code class="pp-mono">npm run db:init</code>。
        </span>
      </div>
    </div>

    <div class="pp-row">
      <span class="pp-badge pp-badge--blue">共 {{ tasks.length }} 项</span>
      <span class="pp-caption">{{ days.length }} 天 × {{ themes.length }} 个主题</span>
      <span class="pp-caption">累计已打卡 {{ n(totalDone) }} 次</span>
    </div>

    <div v-if="loading" class="pp-card">
      <div v-for="i in 6" :key="i" class="pp-skel" style="height: 40px; margin-bottom: 8px"></div>
    </div>

    <template v-else>
      <div v-for="day in days" :key="day.date" class="pp-card">
        <div class="pp-section-head">
          <h3 class="pp-h3">{{ mdText(day.date) }}</h3>
          <span class="pp-badge">{{ day.weekday }}</span>
          <span class="pp-badge">第 {{ day.dayNo }} 天</span>
          <span v-if="day.offlinePoint" class="pp-badge pp-badge--new">线下打卡点：{{ day.offlinePoint }}</span>
          <span class="pp-caption" style="margin-left: auto">当天共 {{ n(day.doneSum) }} 次打卡</span>
        </div>

        <Table
          :columns="columns"
          :data-source="day.tasks"
          :pagination="false"
          :scroll="{ x: 860 }"
          row-key="id"
          size="middle"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'theme'">
              <span class="pp-badge" :style="themeTagStyle(record.theme)">{{ record.theme }}</span>
            </template>
            <template v-else-if="column.key === 'name'">
              <span style="font-weight: 600">{{ record.name }}</span>
              <span v-if="record.isOffline" class="pp-badge pp-badge--new" style="margin-left: 4px; font-size: 11px">线下</span>
            </template>
            <template v-else-if="column.key === 'desc'">
              <span class="cell-text">{{ record.desc }}</span>
            </template>
            <template v-else-if="column.key === 'how'">
              <span class="cell-text">{{ record.how }}</span>
            </template>
            <template v-else-if="column.key === 'doneCount'">
              <b>{{ n(record.doneCount) }}</b>
            </template>
          </template>
        </Table>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { Table } from 'ant-design-vue';
import { adminApi } from '../../api.js';
import { THEMES, THEME_COLORS, mdText } from '../../utils.js';
import { toastErr } from '../../toast.js';

const loading = ref(true);
const tasks = ref([]);
const themes = THEMES;

const totalDone = computed(() => tasks.value.reduce((n, t) => n + t.doneCount, 0));

/** 字典是只读的、总量固定 49 行，分页器没必要出现 */
const columns = [
  { title: '主题', key: 'theme', width: 100 },
  { title: '任务名', key: 'name', width: 170 },
  { title: '玩法', key: 'desc' },
  { title: '打卡要求', key: 'how' },
  { title: '已打卡', key: 'doneCount', align: 'right', width: 100 },
];

const days = computed(() => {
  const map = new Map();
  tasks.value.forEach((t) => {
    if (!map.has(t.date)) {
      map.set(t.date, { date: t.date, weekday: t.weekday, dayNo: 0, offlinePoint: '', tasks: [], doneSum: 0 });
    }
    const d = map.get(t.date);
    d.tasks.push(t);
    if (t.isOffline && t.offlinePoint) d.offlinePoint = t.offlinePoint;
    d.doneSum += t.doneCount;
  });
  const list = [...map.values()];
  list.forEach((d, i) => { d.dayNo = i + 1; });
  return list;
});

function n(v) { return Number(v || 0).toLocaleString('zh-CN'); }

function themeTagStyle(theme) {
  const hex = THEME_COLORS[theme] || '#1d1d1f';
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return { background: `rgba(${r},${g},${b},.12)`, color: hex, fontWeight: 600 };
}

onMounted(async () => {
  try {
    const data = await adminApi.tasks();
    tasks.value = data.tasks;
  } catch (e) {
    toastErr(e.message);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.cell-text { font-size: 13px; color: #333; line-height: 1.6; display: inline-block; max-width: 320px; }
</style>
