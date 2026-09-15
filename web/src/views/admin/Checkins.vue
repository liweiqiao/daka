<template>
  <div style="display: flex; flex-direction: column; gap: 20px">
    <!-- 筛选：保持 Planpoint 原生控件，只有表格换成了 a-v -->
    <div class="pp-card pp-card--pad-sm">
      <div class="pp-filters">
        <input v-model="q.keyword" class="pp-input pp-input--sm" style="min-width: 190px" placeholder="姓名 / 手机号" @keyup.enter="reloadFromFirst" />
        <input v-model="q.school" class="pp-input pp-input--sm" placeholder="学校（模糊）" @keyup.enter="reloadFromFirst" />
        <input v-model="q.date" class="pp-input pp-input--sm" type="date" @change="reloadFromFirst" />
        <select v-model="q.theme" class="pp-select pp-input--sm" @change="reloadFromFirst">
          <option value="">全部主题</option>
          <option v-for="t in THEMES" :key="t" :value="t">{{ t }}</option>
        </select>
        <button class="pp-tag" :class="{ 'is-on': q.offline === '1' }" type="button" @click="toggleOffline">
          只看线下打卡点
        </button>

        <div class="pp-spacer"></div>

        <button class="pp-btn pp-btn--outline pp-btn--sm" type="button" @click="reset">重置</button>
        <button class="pp-btn pp-btn--sm" type="button" :disabled="busy" @click="reloadFromFirst">查询</button>
      </div>
    </div>

    <!-- 汇总条 -->
    <div class="pp-row">
      <span class="pp-badge pp-badge--blue">共 {{ n(total) }} 条</span>
      <span class="pp-caption">第 {{ page }} / {{ Math.max(1, pages) }} 页</span>
      <div class="pp-spacer"></div>
      <button class="pp-btn pp-btn--dark pp-btn--sm" type="button" :disabled="busy" @click="exportCsv">导出当前筛选结果</button>
    </div>

    <!-- 表格 -->
    <Table
      :columns="columns"
      :data-source="list"
      :pagination="pagination"
      :loading="loading"
      :scroll="{ x: 1300 }"
      row-key="id"
      size="middle"
      @change="onTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'date'">
          <span class="nowrap">{{ mdText(record.date) }}</span>
          <span class="pp-caption" style="margin-left: 6px">{{ record.weekday }}</span>
        </template>

        <template v-else-if="column.key === 'theme'">
          <span class="pp-badge" :style="themeTagStyle(record.theme)">{{ record.theme }}</span>
          <span v-if="record.isOffline" class="pp-badge pp-badge--new" style="margin-left: 4px">线下</span>
        </template>

        <template v-else-if="column.key === 'name'">
          <span style="font-weight: 600">{{ record.participant.name }}</span>
        </template>

        <template v-else-if="column.key === 'school'">
          <span class="cell-clip">{{ record.participant.school }}</span>
        </template>

        <template v-else-if="column.key === 'phone'">
          <span class="pp-mono">{{ record.participant.phoneRaw }}</span>
        </template>

        <template v-else-if="column.key === 'time'">
          <span class="pp-caption">{{ hhmm(record.createdAt) }}</span>
        </template>

        <template v-else-if="column.key === 'action'">
          <button class="pp-btn pp-btn--ghost pp-btn--sm" type="button" @click="openDetail(record)">看凭证</button>
          <button class="pp-btn pp-btn--dark pp-btn--sm" type="button" @click="askDelete(record)">删除</button>
        </template>
      </template>
    </Table>

    <!-- 凭证查看 -->
    <div v-if="detail.open" class="pp-mask" @click.self="closeDetail">
      <div class="pp-modal pp-modal--wide">
        <div class="pp-modal__head">
          <div>
            <h3 class="pp-h3">{{ detail.data ? detail.data.checkin.name : '' }} · {{ detail.data ? detail.data.checkin.theme : '' }}</h3>
            <span v-if="detail.data" class="pp-caption">
              {{ mdText(detail.data.checkin.checkin_date) }} · {{ detail.data.checkin.task_name }} ·
              {{ detail.data.checkin.school }} · {{ detail.data.checkin.phoneRaw }}
            </span>
          </div>
          <button class="pp-modal__close" type="button" @click="closeDetail">×</button>
        </div>

        <div v-if="detail.loading" class="pp-empty">加载中…</div>
        <div v-else-if="!detail.data || !detail.data.media.length" class="pp-empty">这一条没有凭证文件</div>
        <div v-else class="pp-media-grid">
          <div v-for="m in detail.data.media" :key="m.id" class="pp-media">
            <div class="pp-media__box">
              <video v-if="m.type === 'video'" :src="m.url" controls preload="metadata"></video>
              <a v-else :href="m.url" target="_blank" rel="noopener">
                <img :src="m.url" alt="凭证" loading="lazy" />
              </a>
            </div>
            <div class="pp-media__meta">
              <div>{{ m.type === 'video' ? '视频' : '照片' }} · {{ m.sizeMB }} MB</div>
              <div class="pp-mono" style="margin-top: 2px; word-break: break-all">{{ m.key }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认 -->
    <div v-if="del.open" class="pp-mask" @click.self="del.open = false">
      <div class="pp-modal" style="max-width: 460px">
        <div class="pp-modal__head">
          <h3 class="pp-h3">删除这条打卡？</h3>
          <button class="pp-modal__close" type="button" @click="del.open = false">×</button>
        </div>
        <p class="pp-lead">
          {{ del.row && del.row.participant.name }} 在 {{ del.row && mdText(del.row.date) }} 的
          「{{ del.row && del.row.theme }} · {{ del.row && del.row.taskName }}」将被删除，
          删除后这位参与者可以重新提交这一项。
        </p>
        <p class="pp-caption" style="margin-top: 12px">操作会记入后台日志。</p>
        <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px">
          <button class="pp-btn pp-btn--outline pp-btn--sm" type="button" @click="del.open = false">取消</button>
          <button class="pp-btn pp-btn--dark pp-btn--sm" type="button" :disabled="del.busy" @click="doDelete">
            {{ del.busy ? '删除中…' : '确认删除' }}
          </button>
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
import { THEMES, THEME_COLORS, mdText, hhmm } from '../../utils.js';
import { toastOk, toastErr } from '../../toast.js';

const route = useRoute();

const q = reactive({ keyword: '', school: '', date: '', theme: '', offline: '', participantId: '' });

const page = ref(1);
const pageSize = ref(50);
const total = ref(0);
const pages = ref(1);
const list = ref([]);
const loading = ref(true);
const busy = ref(false);

const detail = reactive({ open: false, loading: false, data: null });
const del = reactive({ open: false, row: null, busy: false });

/**
 * 服务端分页：a-table 的 pagination 只做"显示"，真正的翻页在 onTableChange 里
 * 重新请求。所以这里必须给 total，否则分页器算不出页数。
 */
const pagination = computed(() => ({
  current: page.value,
  pageSize: pageSize.value,
  total: total.value,
  showSizeChanger: true,
  pageSizeOptions: ['30', '50', '100'],
  showTotal: (t) => `共 ${t} 条`,
}));

/**
 * 明细页不给排序器 —— 后端 /api/admin/checkins 没有 orderBy 参数，
 * 挂了排序图标却只排当前页，比不能排更误导人。
 */
const columns = [
  { title: '日期', key: 'date', width: 130 },
  { title: '主题', key: 'theme', width: 130 },
  { title: '任务', dataIndex: 'taskName', key: 'taskName', width: 150 },
  { title: '姓名', key: 'name', width: 110 },
  { title: '学校', key: 'school', width: 180 },
  { title: '联系方式', key: 'phone', width: 130 },
  { title: '照片', dataIndex: ['batch', 'photos'], key: 'photos', align: 'right', width: 80 },
  { title: '视频', dataIndex: ['batch', 'videos'], key: 'videos', align: 'right', width: 80 },
  { title: '打卡时间', key: 'time', width: 110 },
  { title: '操作', key: 'action', width: 170, fixed: 'right' },
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

/** 只送后端认识的参数，多余字段不发，避免出现"筛选了但没生效"的困惑 */
function queryFor() {
  const out = { page: page.value, pageSize: pageSize.value };
  Object.entries(q).forEach(([k, v]) => { if (v) out[k] = v; });
  return out;
}

async function reload() {
  busy.value = true;
  loading.value = true;
  try {
    const data = await adminApi.checkins(queryFor());
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

/** 改了筛选条件必须回到第 1 页，否则会停在一个不存在的页码上 */
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
  q.date = '';
  q.theme = '';
  q.offline = '';
  q.participantId = '';

  page.value = 1;
  reload();
}

function toggleOffline() {
  q.offline = q.offline === '1' ? '' : '1';
  reloadFromFirst();
}

async function openDetail(row) {
  detail.open = true;
  detail.loading = true;
  detail.data = null;
  try {
    detail.data = await adminApi.checkinMedia(row.id);
  } catch (e) {
    toastErr(e.message);
    detail.open = false;
  } finally {
    detail.loading = false;
  }
}
function closeDetail() { detail.open = false; detail.data = null; }

function askDelete(row) {
  del.row = row;
  del.open = true;
}

async function doDelete() {
  if (!del.row) return;
  del.busy = true;
  try {
    const r = await adminApi.deleteCheckin(del.row.id);
    toastOk(r.message || '已删除');
    del.open = false;
    // 删完可能是空页，回退一页更符合直觉
    if (list.value.length === 1 && page.value > 1) page.value -= 1;
    reload();
  } catch (e) {
    toastErr(e.message);
  } finally {
    del.busy = false;
  }
}

async function exportCsv() {
  busy.value = true;
  try {
    const r = await download('/api/admin/export/checkins', queryFor(), '打卡明细.csv');
    toastOk(`已导出 ${r.name}`);
  } catch (e) {
    toastErr(e.message);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  // 从别处跳过来时可以带上筛选条件，例如总览的「重名提醒」跳到参与者页
  if (typeof route.query.participantId === 'string') q.participantId = route.query.participantId;
  if (typeof route.query.date === 'string') q.date = route.query.date;
  if (typeof route.query.theme === 'string') q.theme = route.query.theme;
  reload();
});
</script>

<style scoped>
.nowrap { white-space: nowrap; }
.cell-clip { display: inline-block; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
</style>
