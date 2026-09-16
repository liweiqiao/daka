<template>
  <div style="display: flex; flex-direction: column; gap: 20px">
    <Card class="dub-card--mist" :body-style="{ padding: '20px' }">
      <div class="pp-row">
        <Tag class="dub-tag--blue">即时生效</Tag>
        <span class="pp-caption" style="flex: 1; min-width: 240px">
          这里的设置存在数据库里，覆盖服务器上的 .env 配置，保存后立刻生效，不需要重启服务。
          活动期间要临时关掉打卡、调小视频上限，都从这里改。
        </span>
      </div>
    </Card>

    <Card v-if="loading">
      <div v-for="i in 6" :key="i" class="pp-skel" style="height: 44px; margin-bottom: 10px"></div>
    </Card>

    <template v-else>
      <Card v-for="group in groups" :key="group.title">
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

            <!-- 长文案用 textarea，布尔开关用 switch，日期用 DatePicker，其余走 input -->
            <Input.TextArea
              v-if="isLong(key)"
              :id="`s-${key}`"
              v-model:value="form[key]"
            />

            <div v-else-if="isBool(key)" class="pp-row">
              <Switch :checked="form[key] === '1'" @change="(c) => (form[key] = c ? '1' : '0')" />
              <span class="pp-caption">{{ form[key] === '1' ? '开启' : '关闭' }}</span>
            </div>

            <DatePicker
              v-else-if="isDate(key)"
              :id="`s-${key}`"
              v-model:value="form[key]"
              value-format="YYYY-MM-DD"
              :allow-clear="false"
              style="width: 100%"
            />

            <Input
              v-else
              :id="`s-${key}`"
              v-model:value="form[key]"
              :type="isNum(key) ? 'number' : 'text'"
            />
          </div>
        </div>
      </Card>

      <Card :body-style="{ padding: '20px' }" style="position: sticky; bottom: 0">
        <div class="pp-row">
          <Button size="small" :disabled="busy" @click="load">放弃改动</Button>
          <Tag v-if="dirtyCount" class="dub-tag--new">{{ dirtyCount }} 项已修改未保存</Tag>
          <span v-else class="pp-caption">没有未保存的改动</span>
          <div class="pp-spacer"></div>
          <Button type="primary" size="small" :disabled="busy || !dirtyCount" @click="save">
            {{ busy ? '保存中…' : '保存设置' }}
          </Button>
        </div>
      </Card>

      <!-- 操作日志 -->
      <Card>
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
              <Tag>{{ record.action }}</Tag>
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
      </Card>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { Table, Card, Button, Input, Switch, Tag, DatePicker } from 'ant-design-vue';
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
    title: '活动日期',
    note: '决定打卡窗口的第一天和最后一天，改完立即生效；改动开始日期后，49 张每日任务卡会整体跟着平移（已提交的打卡记录不受影响）',
    keys: ['activity_start', 'activity_end'],
  },
  {
    title: '活动文案',
    note: '家长在首页和打卡页看到的内容。首页主画面那两行字（口号 + 小字）单独配，页脚仍然用活动标题',
    keys: ['hero_eyebrow', 'hero_title', 'activity_title', 'activity_subtitle', 'activity_intro', 'activity_notice', 'certificate_note'],
  },
  {
    title: '打卡开关',
    note: '数据异常时可临时关闭提交入口；照片墙涉及孩子照片，想临时撤下也在这里关',
    keys: ['checkin_open', 'gallery_public'],
  },
  {
    title: '上传限制',
    note: '改小可以省空间；视频是空间消耗的大头',
    keys: ['photo_max_mb', 'photo_max_count', 'video_max_mb', 'video_max_sec', 'video_max_count'],
  },
  {
    title: '荣誉门槛',
    note: '改完立即影响荣誉名单与个人进度',
    keys: ['honor_theme_cert', 'honor_total'],
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
const BOOL_KEYS = ['checkin_open', 'gallery_public'];
const DATE_KEYS = ['activity_start', 'activity_end'];
const NUM_KEYS = ['photo_max_mb', 'photo_max_count', 'video_max_mb', 'video_max_sec', 'video_max_count',
  'honor_theme_cert', 'honor_total'];

const isLong = (k) => LONG_KEYS.includes(k);
const isBool = (k) => BOOL_KEYS.includes(k);
const isDate = (k) => DATE_KEYS.includes(k);
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

  // 活动日期前端预校验：开始不能晚于结束
  const s = 'activity_start' in changed ? changed.activity_start : original.value.activity_start;
  const e = 'activity_end' in changed ? changed.activity_end : original.value.activity_end;
  if (s && e && String(s) > String(e)) {
    toastErr('活动开始日期不能晚于结束日期');
    return;
  }

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
