<template>
  <div style="display: flex; flex-direction: column; gap: 20px">
    <div class="pp-card pp-card--pad-sm">
      <div class="pp-filters">
        <input v-model="q.keyword" class="pp-input pp-input--sm" style="min-width: 200px" placeholder="姓名 / 手机号 / 学校" @keyup.enter="reloadFromFirst" />
        <input v-model="q.school" class="pp-input pp-input--sm" placeholder="学校（模糊）" @keyup.enter="reloadFromFirst" />
        <!--
          排序留在下拉里，不给 a-table 挂排序器：后端 /api/admin/participants 的
          ORDER BY 写死了 DESC，a-table 的「升序」点了不会有任何变化，
          挂了图标反而让人以为排序坏了。
        -->
        <select v-model="q.orderBy" class="pp-select pp-input--sm" style="width: auto" @change="reloadFromFirst">
          <option value="total">按打卡次数</option>
          <option value="themes">按覆盖主题数</option>
          <option value="days">按打卡天数</option>
          <option value="created_at">按登记时间</option>
          <option value="school">按学校</option>
          <option value="name">按姓名</option>
        </select>
        <button class="pp-tag" :class="{ 'is-on': q.idle === '1' }" type="button" @click="toggleIdle">
          只看已登记未打卡
        </button>

        <div class="pp-spacer"></div>

        <button class="pp-btn pp-btn--outline pp-btn--sm" type="button" @click="reset">重置</button>
        <button class="pp-btn pp-btn--dark pp-btn--sm" type="button" :disabled="busy" @click="exportCsv">导出名单</button>
      </div>
    </div>

    <div class="pp-row">
      <span class="pp-badge pp-badge--blue">共 {{ n(total) }} 人</span>
      <span class="pp-caption">第 {{ page }} / {{ Math.max(1, pages) }} 页</span>
      <div class="pp-spacer"></div>
      <span class="pp-caption">点姓名可查看这个孩子的全部记录</span>
    </div>

    <Table
      :columns="columns"
      :data-source="list"
      :pagination="pagination"
      :loading="loading"
      :scroll="{ x: 1320 }"
      row-key="id"
      size="middle"
      @change="onTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'id'">
          <span class="pp-mono">{{ record.id }}</span>
        </template>

        <template v-else-if="column.key === 'name'">
          <button class="linkbtn" type="button" @click="openDetail(record)">{{ record.name }}</button>
        </template>

        <template v-else-if="column.key === 'school'">
          <span class="cell-clip">{{ record.school }}</span>
        </template>

        <template v-else-if="column.key === 'phone'">
          <span class="pp-mono">{{ record.phoneRaw }}</span>
        </template>

        <template v-else-if="column.key === 'themes'">
          {{ record.themes }}<span class="pp-caption">/7</span>
        </template>

        <template v-else-if="column.key === 'honors'">
          <span v-for="h in record.honors" :key="h" class="pp-badge pp-badge--done" style="margin-right: 4px">{{ h }}</span>
          <span v-if="!record.honors.length" class="pp-caption">—</span>
        </template>

        <template v-else-if="column.key === 'registeredAt'">
          <span class="pp-caption">{{ (record.registeredAt || '').slice(0, 10) }}</span>
        </template>

        <template v-else-if="column.key === 'action'">
          <router-link :to="`/admin/checkins?participantId=${record.id}`" class="pp-btn pp-btn--ghost pp-btn--sm">
            看打卡
          </router-link>
        </template>
      </template>
    </Table>

    <!-- 个人详情 -->
    <div v-if="detail.open" class="pp-mask" @click.self="closeDetail">
      <div class="pp-modal pp-modal--wide">
        <div class="pp-modal__head">
          <div v-if="detail.data">
            <h3 class="pp-h3">{{ detail.data.participant.name }}</h3>
            <span class="pp-caption">
              {{ detail.data.participant.school }} · {{ detail.data.participant.phoneRaw }} ·
              登记于 {{ (detail.data.participant.registeredAt || '').slice(0, 10) }}
            </span>
          </div>
          <div v-else><h3 class="pp-h3">加载中…</h3></div>
          <button class="pp-modal__close" type="button" @click="closeDetail">×</button>
        </div>

        <div v-if="detail.data">
          <div class="pp-grid pp-grid--3" style="margin-bottom: 20px">
            <div class="pp-kpi" style="padding: 20px">
              <div class="pp-kpi__label">累计打卡</div>
              <div class="pp-kpi__value" style="font-size: 34px">{{ detail.data.progress.total }}</div>
            </div>
            <div class="pp-kpi" style="padding: 20px">
              <div class="pp-kpi__label">打卡天数</div>
              <div class="pp-kpi__value" style="font-size: 34px">{{ detail.data.progress.days }}</div>
            </div>
            <div class="pp-kpi" style="padding: 20px">
              <div class="pp-kpi__label">覆盖主题</div>
              <div class="pp-kpi__value" style="font-size: 34px">{{ detail.data.progress.themesHit }}<span class="pp-kpi__unit">/7</span></div>
            </div>
          </div>

          <div v-if="detail.data.progress.honors.length" style="margin-bottom: 16px">
            <span v-for="h in detail.data.progress.honors" :key="h.key" class="pp-badge pp-badge--done" style="margin-right: 6px">
              {{ h.name }}
            </span>
          </div>

          <div v-if="detail.data.sameName.length" class="pp-card pp-card--mist pp-card--pad-sm" style="margin-bottom: 20px">
            <div class="pp-row">
              <span class="pp-badge pp-badge--warn">同名提醒</span>
              <span class="pp-caption">
                还有 {{ detail.data.sameName.length }} 位同名孩子，分别来自
                {{ detail.data.sameName.map((s) => s.school).join('、') }}
              </span>
            </div>
          </div>

          <div class="pp-section-head"><h4 class="pp-h3">打卡记录</h4></div>
          <div v-if="!detail.data.records.length" class="pp-empty" style="padding: 24px 0">这个人还没有任何打卡</div>
          <div v-else class="recs">
            <div v-for="day in detail.data.records" :key="day.date" class="rec">
              <div class="rec__head">
                <b>{{ mdText(day.date) }}</b>
                <span class="pp-caption">{{ day.weekday }} · {{ day.count }} 项 · {{ day.photos }} 张照片<span v-if="day.videos"> · {{ day.videos }} 段视频</span></span>
              </div>
              <div v-for="it in day.items" :key="it.checkinId" class="rec__item">
                <span class="pp-badge" :style="themeTagStyle(it.theme)">{{ it.theme }}</span>
                <span style="font-weight: 600">{{ it.taskName }}</span>
                <span v-if="it.remark" class="pp-caption cell-clip" style="max-width: 320px">{{ it.remark }}</span>
                <span class="pp-spacer"></span>
                <span class="pp-caption">{{ hhmm(it.createdAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { Table } from 'ant-design-vue';
import { adminApi, download } from '../../api.js';
import { THEME_COLORS, mdText, hhmm } from '../../utils.js';
import { toastOk, toastErr } from '../../toast.js';

const route = useRoute();

const q = reactive({ keyword: '', school: '', orderBy: 'total', idle: '' });
const page = ref(1);
const pageSize = ref(50);
const total = ref(0);
const pages = ref(1);
const list = ref([]);
const loading = ref(true);
const busy = ref(false);
const detail = reactive({ open: false, data: null });

const pagination = computed(() => ({
  current: page.value,
  pageSize: pageSize.value,
  total: total.value,
  showSizeChanger: true,
  pageSizeOptions: ['30', '50', '100'],
  showTotal: (t) => `共 ${t} 人`,
}));

const columns = [
  { title: 'ID', key: 'id', width: 80 },
  { title: '姓名', key: 'name', width: 110 },
  { title: '学校', key: 'school', width: 200 },
  { title: '联系方式', key: 'phone', width: 130 },
  { title: '累计次数', dataIndex: 'total', key: 'total', align: 'right', width: 100 },
  { title: '覆盖主题', key: 'themes', align: 'right', width: 100 },
  { title: '打卡天数', dataIndex: 'days', key: 'days', align: 'right', width: 100 },
  { title: '荣誉', key: 'honors', width: 200 },
  { title: '登记时间', key: 'registeredAt', width: 120 },
  { title: '操作', key: 'action', width: 110, fixed: 'right' },
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

function queryFor() {
  const out = { page: page.value, pageSize: pageSize.value, orderBy: q.orderBy };
  if (q.keyword) out.keyword = q.keyword;
  if (q.school) out.school = q.school;
  if (q.idle) out.idle = q.idle;
  return out;
}

async function reload() {
  busy.value = true;
  loading.value = true;
  try {
    const data = await adminApi.participants(queryFor());
    list.value = data.list;
    total.value = data.total;
    pages.value = data.pages || 1;
  } catch (e) {
    toastErr(e.message);
  } finally {
    busy.value = false;
    loading.value = false;
  }
}

function reloadFromFirst() {
  page.value = 1;
  reload();
}

function onTableChange(pag) {
  page.value = pag.current;
  pageSize.value = pag.pageSize;
  reload();
}

function reset() {
  q.keyword = '';
  q.school = '';
  q.orderBy = 'total';
  q.idle = '';
  page.value = 1;
  reload();
}
function toggleIdle() {
  q.idle = q.idle === '1' ? '' : '1';
  reloadFromFirst();
}

async function openDetail(p) {
  detail.open = true;
  detail.data = null;
  try {
    detail.data = await adminApi.participant(p.id);
  } catch (e) {
    toastErr(e.message);
    detail.open = false;
  }
}
function closeDetail() { detail.open = false; detail.data = null; }

async function exportCsv() {
  busy.value = true;
  try {
    const r = await download('/api/admin/export/participants', queryFor(), '参与者名单.csv');
    toastOk(`已导出 ${r.name}`);
  } catch (e) {
    toastErr(e.message);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  if (typeof route.query.keyword === 'string') q.keyword = route.query.keyword;
  if (typeof route.query.idle === 'string') q.idle = route.query.idle;
  reload();
});
</script>

<style scoped>
/* 链接色走 --pp-link（#007aff）。规范里 #0f68ea 是动作色，
   "不要用它做正文或标题的文字颜色" —— 文字链接属于 link-blue 的辖区。 */
.linkbtn {
  font-weight: 600;
  color: var(--pp-link);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.linkbtn:hover { filter: brightness(1.1); }

.cell-clip { display: inline-block; max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }

.recs { display: flex; flex-direction: column; gap: 12px; }
.rec {
  border: 1px solid var(--pp-fog);
  border-radius: 18px;
  overflow: hidden;
}
.rec__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 12px 16px;
  background: var(--pp-mist);
  flex-wrap: wrap;
}
.rec__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid var(--pp-fog);
  font-size: 14px;
  flex-wrap: wrap;
}
</style>
