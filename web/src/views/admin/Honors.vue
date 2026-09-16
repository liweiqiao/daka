<template>
  <div style="display: flex; flex-direction: column; gap: 20px">
    <Card :body-style="{ padding: '20px' }">
      <div class="pp-filters">
        <Tag
          v-for="t in tabs"
          :key="t.key"
          :class="activeTab === t.key ? 'dub-tag--accent' : ''"
          style="cursor: pointer"
          @click="activeTab = t.key"
        >
          {{ t.label }}
        </Tag>

        <Input v-model:value="keyword" size="small" style="min-width: 200px" placeholder="按姓名 / 学校筛选" @keyup.enter="reload" />

        <div class="pp-spacer"></div>

        <Button size="small" :disabled="busy" @click="reload">刷新</Button>
        <Button type="primary" size="small" :disabled="busy" @click="exportCsv">导出荣誉名单</Button>
      </div>
    </Card>

    <!-- 规则说明 -->
    <div class="pp-grid pp-grid--3">
      <Card class="dub-kpi" :body-style="{ padding: '20px' }" :class="{ 'dub-kpi--brand': activeTab === 'allThemes' }">
        <div class="dub-kpi__label">全能少年</div>
        <div class="dub-kpi__value">{{ n(counts.allThemes) }}<span class="dub-kpi__unit">人</span></div>
        <div class="dub-kpi__foot">7 个主题每个至少完成 1 次</div>
      </Card>
      <Card class="dub-kpi" :body-style="{ padding: '20px' }" :class="{ 'dub-kpi--brand': activeTab === 'dakaMaster' }">
        <div class="dub-kpi__label">打卡达人</div>
        <div class="dub-kpi__value">{{ n(counts.dakaMaster) }}<span class="dub-kpi__unit">人</span></div>
        <div class="dub-kpi__foot">累计有效打卡 ≥ {{ thresholds.dakaMaster }} 次</div>
      </Card>
      <Card class="dub-kpi" :body-style="{ padding: '20px' }" :class="{ 'dub-kpi--brand': activeTab === 'themeStar' }">
        <div class="dub-kpi__label">主题之星</div>
        <div class="dub-kpi__value">{{ n(starTotal) }}<span class="dub-kpi__unit">人次</span></div>
        <div class="dub-kpi__foot">单个主题完成 ≥ {{ thresholds.themeStar }} 次</div>
      </Card>
    </div>

    <Card v-if="loading">
      <div v-for="i in 5" :key="i" class="pp-skel" style="height: 38px; margin-bottom: 8px"></div>
    </Card>

    <!-- 全能少年 -->
    <template v-else-if="activeTab === 'allThemes'">
      <Table
        :columns="columns"
        :data-source="data.allThemes"
        :pagination="pagination"
        :scroll="{ x: 900 }"
        row-key="id"
        size="middle"
      >
        <template #bodyCell="{ column, record, index }">
          <template v-if="column.key === 'no'">
            <span class="pp-caption">{{ index + 1 }}</span>
          </template>
          <template v-else-if="column.key === 'name'">
            <span style="font-weight: 600">{{ record.name }}</span>
          </template>
          <template v-else-if="column.key === 'school'">
            <span class="cell-clip">{{ record.school }}</span>
          </template>
          <template v-else-if="column.key === 'phone'">
            <span class="pp-mono">{{ record.phoneRaw }}</span>
          </template>
          <template v-else-if="column.key === 'themes'">
            <Tag class="dub-tag--done">{{ record.themes }}/7</Tag>
          </template>
        </template>
      </Table>
    </template>

    <!-- 打卡达人 -->
    <template v-else-if="activeTab === 'dakaMaster'">
      <Table
        :columns="columns"
        :data-source="data.dakaMaster"
        :pagination="pagination"
        :scroll="{ x: 900 }"
        row-key="id"
        size="middle"
      >
        <template #bodyCell="{ column, record, index }">
          <template v-if="column.key === 'no'">
            <span class="pp-caption">{{ index + 1 }}</span>
          </template>
          <template v-else-if="column.key === 'name'">
            <span style="font-weight: 600">{{ record.name }}</span>
          </template>
          <template v-else-if="column.key === 'school'">
            <span class="cell-clip">{{ record.school }}</span>
          </template>
          <template v-else-if="column.key === 'phone'">
            <span class="pp-mono">{{ record.phoneRaw }}</span>
          </template>
          <template v-else-if="column.key === 'themes'">
            {{ record.themes }}/7
          </template>
        </template>
      </Table>
    </template>

    <!-- 主题之星 -->
    <template v-else>
      <Card v-if="!data.themeStar.length" class="pp-empty">还没有人达成「主题之星」</Card>
      <div v-else class="pp-grid pp-grid--2" style="align-items: start">
        <Card v-for="g in data.themeStar" :key="g.theme">
          <div class="pp-section-head">
            <Tag :style="themeTagStyle(g.theme)">
              {{ g.theme }}
            </Tag>
            <span class="pp-caption">{{ g.list.length }} 人达 {{ thresholds.themeStar }} 次以上</span>
          </div>
          <div class="star-list">
            <div v-for="p in g.list" :key="p.id" class="star">
              <span class="star__name">{{ p.name }}</span>
              <span class="star__school pp-caption cell-clip">{{ p.school }}</span>
              <span class="star__num">{{ p.themeCount }} 次</span>
            </div>
          </div>
        </Card>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { Table, Card, Button, Input, Tag } from 'ant-design-vue';
import { adminApi, download } from '../../api.js';
import { THEME_COLORS } from '../../utils.js';
import { toastOk, toastErr } from '../../toast.js';

const tabs = [
  { key: 'allThemes', label: '全能少年' },
  { key: 'dakaMaster', label: '打卡达人' },
  { key: 'themeStar', label: '主题之星' },
];

const activeTab = ref('allThemes');
const keyword = ref('');
const loading = ref(true);
const busy = ref(false);
const data = ref({ thresholds: {}, allThemes: [], dakaMaster: [], themeStar: [] });

const thresholds = computed(() => data.value.thresholds || {});
const counts = computed(() => ({
  allThemes: (data.value.allThemes || []).length,
  dakaMaster: (data.value.dakaMaster || []).length,
}));
const starTotal = computed(() => (data.value.themeStar || []).reduce((n, g) => n + g.list.length, 0));

/**
 * 荣誉名单是**一次性全取**的（后端按类型各给一份，上限 2000），
 * 所以分页放在前端做，不用再为翻页发请求。
 */
const pagination = computed(() => ({
  pageSize: 50,
  showSizeChanger: true,
  pageSizeOptions: ['20', '50', '100'],
  showTotal: (t) => `共 ${t} 人`,
}));

const columns = [
  { title: '序号', key: 'no', width: 80, align: 'right' },
  { title: '姓名', key: 'name', width: 120 },
  { title: '学校', key: 'school' },
  { title: '联系方式', key: 'phone', width: 140 },
  { title: '累计次数', dataIndex: 'total', key: 'total', align: 'right', width: 110 },
  { title: '覆盖主题', key: 'themes', align: 'right', width: 120 },
];

function n(v) { return Number(v || 0).toLocaleString('zh-CN'); }

function themeTagStyle(theme) {
  const hex = THEME_COLORS[theme] || '#1d1d1f';
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return { background: `rgba(${r},${g},${b},.12)`, color: hex, fontWeight: 600 };
}

async function reload() {
  busy.value = true;
  loading.value = true;
  try {
    // 三个类型一次全取：1000 人规模下这几次聚合很快，省得切 tab 再等
    data.value = await adminApi.honors({ types: 'allThemes,dakaMaster,themeStar', keyword: keyword.value });
  } catch (e) {
    toastErr(e.message);
  } finally {
    busy.value = false;
    loading.value = false;
  }
}

async function exportCsv() {
  busy.value = true;
  try {
    const r = await download('/api/admin/export/honors', { keyword: keyword.value }, '荣誉名单.csv');
    toastOk(`已导出 ${r.name}`);
  } catch (e) {
    toastErr(e.message);
  } finally {
    busy.value = false;
  }
}

onMounted(reload);
</script>

<style scoped>
.cell-clip { display: inline-block; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }

.star-list { display: flex; flex-direction: column; }
.star {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--dub-line);
  font-size: 14px;
}
.star:last-child { border-bottom: none; }
.star__name { font-weight: 600; flex-shrink: 0; }
.star__school { flex: 1; min-width: 0; }
.star__num { font-weight: 600; font-variant-numeric: tabular-nums; flex-shrink: 0; }
</style>
