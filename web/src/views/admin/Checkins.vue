<template>
  <div style="display: flex; flex-direction: column; gap: 20px">
    <!-- 筛选 -->
    <Card :body-style="{ padding: '20px' }">
      <div class="pp-filters">
        <Input v-model:value="q.keyword" size="small" style="min-width: 190px" placeholder="姓名 / 手机号" @keyup.enter="reloadFromFirst" />
        <Input v-model:value="q.school" size="small" placeholder="学校（模糊）" @keyup.enter="reloadFromFirst" />
        <DatePicker v-model:value="q.date" size="small" value-format="YYYY-MM-DD" @change="onDateChange" />
        <Select v-model:value="q.theme" size="small" @change="reloadFromFirst">
          <Select-Option value="">全部主题</Select-Option>
          <Select-Option v-for="t in THEMES" :key="t" :value="t">{{ t }}</Select-Option>
        </Select>
        <Tag checkable :checked="q.offline === '1'" @change="toggleOffline">只看线下打卡点</Tag>

        <div class="pp-spacer"></div>

        <Button size="small" @click="reset">重置</Button>
        <Button type="primary" size="small" :disabled="busy" @click="reloadFromFirst">查询</Button>
      </div>
    </Card>

    <!-- 汇总条 -->
    <div class="pp-row">
      <Tag class="dub-tag--blue">共 {{ n(total) }} 条</Tag>
      <span class="pp-caption">第 {{ page }} / {{ Math.max(1, pages) }} 页</span>
      <div class="pp-spacer"></div>
      <Button type="primary" size="small" :disabled="busy" @click="exportCsv">导出当前筛选结果</Button>
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
          <Tag :style="themeTagStyle(record.theme)">{{ record.theme }}</Tag>
          <Tag v-if="record.isOffline" class="dub-tag--new" style="margin-left: 4px">线下</Tag>
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
          <Button type="link" size="small" @click="openDetail(record)">看凭证</Button>
          <Button type="primary" size="small" @click="askDelete(record)">删除</Button>
        </template>
      </template>
    </Table>

    <!-- 凭证查看 -->
    <Modal
      v-model:open="detail.open"
      width="880px"
      :footer="null"
      :title="detail.data ? `${detail.data.checkin.name} · ${detail.data.checkin.theme}` : ''"
    >
      <div v-if="detail.loading" class="pp-empty">加载中…</div>
      <div v-else-if="!detail.data || !detail.data.media.length" class="pp-empty">这一条没有凭证文件</div>
      <div v-else>
        <div v-if="detail.data" class="pp-caption" style="margin-bottom: 12px">
          {{ mdText(detail.data.checkin.checkin_date) }} · {{ detail.data.checkin.task_name }} ·
          {{ detail.data.checkin.school }} · {{ detail.data.checkin.phoneRaw }}
        </div>
        <div class="pp-media-grid">
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
    </Modal>

    <!-- 删除确认 -->
    <Modal v-model:open="del.open" title="删除这条打卡？" :footer="null">
      <p class="pp-lead">
        {{ del.row && del.row.participant.name }} 在 {{ del.row && mdText(del.row.date) }} 的
        「{{ del.row && del.row.theme }} · {{ del.row && del.row.taskName }}」将被删除，
        删除后这位参与者可以重新提交这一项。
      </p>
      <p class="pp-caption" style="margin-top: 12px">操作会记入后台日志。</p>
      <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px">
        <Button size="small" @click="del.open = false">取消</Button>
        <Button type="primary" size="small" :disabled="del.busy" @click="doDelete">
          {{ del.busy ? '删除中…' : '确认删除' }}
        </Button>
      </div>
    </Modal>
  </div>
</template>

<script setup>
import { computed, reactive, ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { Table, Card, Button, Input, Select, SelectOption, DatePicker, Tag, Modal } from 'ant-design-vue';
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

function onDateChange(_d, ds) {
  q.date = ds || '';
  reloadFromFirst();
}

function toggleOffline(c) {
  q.offline = c ? '1' : '';
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
