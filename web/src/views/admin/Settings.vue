<template>
  <div style="display: flex; flex-direction: column; gap: 20px">
    <div class="pp-card pp-card--mist pp-card--pad-sm">
      <div class="pp-row">
        <span class="pp-badge pp-badge--blue">即时生效</span>
        <span class="pp-caption" style="flex: 1; min-width: 240px">
          这里的设置存在数据库里，覆盖服务器上的 .env 配置，保存后立刻生效，不需要重启服务。
          活动期间要临时关掉打卡、调小视频上限，都从这里改。
        </span>
      </div>
    </div>

    <div v-if="loading" class="pp-card">
      <div v-for="i in 6" :key="i" class="pp-skel" style="height: 44px; margin-bottom: 10px"></div>
    </div>

    <template v-else>
      <div v-for="group in groups" :key="group.title" class="pp-card">
        <div class="pp-section-head">
          <h3 class="pp-h3">{{ group.title }}</h3>
          <span class="pp-caption">{{ group.note }}</span>
        </div>

        <div class="pp-grid pp-grid--2">
          <div v-for="key in group.keys" :key="key" class="pp-field">
            <label class="pp-label" :for="`s-${key}`">
              {{ labels[key] || key }}
              <span class="pp-mono" style="color: #999; font-weight: 400; margin-left: 4px">{{ key }}</span>
            </label>

            <!-- 长文案用 textarea，布尔开关用双态按钮，其余走 input -->
            <textarea
              v-if="isLong(key)"
              :id="`s-${key}`"
              v-model="form[key]"
              class="pp-textarea"
            ></textarea>

            <div v-else-if="isBool(key)" class="pp-row">
              <button
                class="pp-tag"
                :class="{ 'is-on': form[key] === '1' }"
                type="button"
                @click="form[key] = '1'"
              >开启</button>
              <button
                class="pp-tag"
                :class="{ 'is-on': form[key] === '0' }"
                type="button"
                @click="form[key] = '0'"
              >关闭</button>
            </div>

            <input
              v-else
              :id="`s-${key}`"
              v-model="form[key]"
              class="pp-input"
              :type="isNum(key) ? 'number' : 'text'"
            />
          </div>
        </div>
      </div>

      <div class="pp-card" style="position: sticky; bottom: 0">
        <div class="pp-row">
          <button class="pp-btn pp-btn--outline pp-btn--sm" type="button" :disabled="busy" @click="load">放弃改动</button>
          <span v-if="dirtyCount" class="pp-badge pp-badge--new">{{ dirtyCount }} 项已修改未保存</span>
          <span v-else class="pp-caption">没有未保存的改动</span>
          <div class="pp-spacer"></div>
          <button class="pp-btn" type="button" :disabled="busy || !dirtyCount" @click="save">
            {{ busy ? '保存中…' : '保存设置' }}
          </button>
        </div>
      </div>

      <!-- 操作日志 -->
      <div class="pp-card">
        <div class="pp-section-head">
          <h3 class="pp-h3">后台操作日志</h3>
          <span class="pp-caption">最近 50 条</span>
        </div>
        <div v-if="!logs.length" class="pp-empty" style="padding: 24px 0">暂无日志</div>
        <Table
          v-else
          :columns="logColumns"
          :data-source="logs"
          :pagination="false"
          :scroll="{ x: 980, y: 340 }"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'created_at'">
              <span class="pp-mono nowrap">{{ record.created_at }}</span>
            </template>
            <template v-else-if="column.key === 'action'">
              <span class="pp-badge">{{ record.action }}</span>
            </template>
            <template v-else-if="column.key === 'target'">
              <span class="pp-mono cell-clip">{{ record.target }}</span>
            </template>
            <template v-else-if="column.key === 'detail'">
              <span class="cell-clip" style="max-width: 320px">{{ record.detail }}</span>
            </template>
            <template v-else-if="column.key === 'ip'">
              <span class="pp-mono nowrap">{{ record.ip }}</span>
            </template>
          </template>
        </Table>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { Table } from 'ant-design-vue';
import { adminApi } from '../../api.js';
import { toastOk, toastErr } from '../../toast.js';

const loading = ref(true);
const busy = ref(false);
const labels = ref({});
const original = ref({});
const form = reactive({});
const logs = ref([]);

const GROUPS = [
  {
    title: '活动文案',
    note: '家长在首页和打卡页看到的内容',
    keys: ['activity_title', 'activity_subtitle', 'activity_intro', 'activity_notice', 'certificate_note'],
  },
  {
    title: '打卡开关',
    note: '数据异常时可临时关闭提交入口',
    keys: ['checkin_open', 'board_public'],
  },
  {
    title: '上传限制',
    note: '改小可以省空间；视频是空间消耗的大头',
    keys: ['photo_max_mb', 'photo_max_count', 'video_max_mb', 'video_max_sec', 'video_max_count'],
  },
  {
    title: '荣誉门槛',
    note: '改完立即影响荣誉名单与个人进度',
    keys: ['honor_all_themes', 'honor_theme_star', 'honor_daka_master'],
  },
];

const groups = computed(() => GROUPS);

/** 操作日志：后端固定给最近 50 条，没有分页，所以分页器关掉、给纵向滚动 */
const logColumns = [
  { title: '时间', key: 'created_at', width: 170 },
  { title: '操作人', dataIndex: 'admin_name', key: 'admin_name', width: 100 },
  { title: '动作', key: 'action', width: 150 },
  { title: '对象', key: 'target', width: 150 },
  { title: '详情', key: 'detail' },
  { title: 'IP', key: 'ip', width: 130 },
];

const LONG_KEYS = ['activity_intro', 'activity_notice', 'certificate_note'];
const BOOL_KEYS = ['checkin_open', 'board_public'];
const NUM_KEYS = ['photo_max_mb', 'photo_max_count', 'video_max_mb', 'video_max_sec', 'video_max_count',
  'honor_all_themes', 'honor_theme_star', 'honor_daka_master'];

const isLong = (k) => LONG_KEYS.includes(k);
const isBool = (k) => BOOL_KEYS.includes(k);
const isNum = (k) => NUM_KEYS.includes(k);

const dirtyCount = computed(() => Object.keys(form).filter((k) => String(form[k]) !== String(original.value[k] ?? '')).length);

async function load() {
  busy.value = true;
  loading.value = true;
  try {
    const data = await adminApi.settings();
    labels.value = data.labels || {};
    original.value = { ...data.values };
    Object.keys(form).forEach((k) => delete form[k]);
    Object.entries(data.values).forEach(([k, v]) => { form[k] = String(v ?? ''); });
  } catch (e) {
    toastErr(e.message);
  } finally {
    busy.value = false;
    loading.value = false;
  }
}

async function save() {
  const changed = {};
  Object.keys(form).forEach((k) => {
    if (String(form[k]) !== String(original.value[k] ?? '')) changed[k] = form[k];
  });
  if (!Object.keys(changed).length) return;

  busy.value = true;
  try {
    const r = await adminApi.saveSettings(changed);
    original.value = { ...r.values };
    toastOk(r.message || '设置已保存');
    loadLogs();
  } catch (e) {
    toastErr(e.message);
  } finally {
    busy.value = false;
  }
}

async function loadLogs() {
  try {
    const d = await adminApi.oplog(50);
    logs.value = d.list || [];
  } catch (e) { /* 日志不是关键路径，失败静默 */ }
}

onMounted(async () => {
  await load();
  loadLogs();
});
</script>

<style scoped>
.nowrap { white-space: nowrap; }
.cell-clip { display: inline-block; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
</style>
