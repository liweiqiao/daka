<template>
  <div style="display: flex; flex-direction: column; gap: 20px">
    <Card class="dub-card--mist" :body-style="{ padding: '20px' }">
      <div class="pp-row">
        <span class="pp-caption" style="flex: 1; min-width: 240px">
          每天的打卡任务默认使用《2026清城少年志每日任务卡》的 49 项，可在这里按项修改，保存后参与者端立即生效。
          已产生的打卡记录存的是当时任务名和主题的快照，不受后续修改影响。
          改乱了可以单条「恢复默认」。
        </span>
      </div>
    </Card>

    <div class="pp-row">
      <Tag class="dub-tag--blue">共 {{ tasks.length }} 项</Tag>
      <span class="pp-caption">{{ days.length }} 天 × {{ themes.length }} 个主题</span>
      <span class="pp-caption">累计已打卡 {{ n(totalDone) }} 次</span>
    </div>

    <Card v-if="loading">
      <div v-for="i in 6" :key="i" class="pp-skel" style="height: 40px; margin-bottom: 8px"></div>
    </Card>

    <template v-else>
      <Card v-for="day in days" :key="day.date">
        <div class="pp-section-head">
          <h3 class="pp-h3">{{ mdText(day.date) }}</h3>
          <Tag>{{ day.weekday }}</Tag>
          <Tag>第 {{ day.dayNo }} 天</Tag>
          <Tag v-if="day.offlinePoint" class="dub-tag--new">线下打卡点：{{ day.offlinePoint }}</Tag>
          <span class="pp-caption" style="margin-left: auto">当天共 {{ n(day.doneSum) }} 次打卡</span>
        </div>

        <Table
          :columns="columns"
          :data-source="day.tasks"
          :pagination="false"
          :scroll="{ x: 960 }"
          row-key="id"
          size="middle"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'theme'">
              <Tag :style="themeTagStyle(record.theme)">{{ record.theme }}</Tag>
            </template>
            <template v-else-if="column.key === 'name'">
              <span style="font-weight: 600">{{ record.name }}</span>
              <Tag v-if="record.isOffline" class="dub-tag--new" style="margin-left: 4px; font-size: 11px">线下</Tag>
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
            <template v-else-if="column.key === 'action'">
              <Button type="link" size="small" style="padding: 0" @click="openEdit(record)">编辑</Button>
              <Popconfirm
                title="恢复成任务卡里的默认内容？"
                ok-text="恢复"
                cancel-text="取消"
                @confirm="doReset(record)"
              >
                <Button type="link" size="small" style="padding: 0">恢复默认</Button>
              </Popconfirm>
            </template>
          </template>
        </Table>
      </Card>
    </template>

    <Modal
      v-model:open="editOpen"
      :title="editForm.id ? `编辑任务 · ${mdText(editForm.date)} / ${editForm.date}` : '编辑任务'"
      :confirm-loading="saving"
      ok-text="保存"
      cancel-text="取消"
      :mask-closable="false"
      @ok="saveEdit"
    >
      <div style="display: flex; flex-direction: column; gap: 14px; padding-top: 8px">
        <div class="pp-row" style="gap: 12px">
          <div style="width: 160px">
            <div class="form-label">主题</div>
            <Select v-model:value="editForm.theme" style="width: 100%">
              <SelectOption v-for="t in themes" :key="t" :value="t">{{ t }}</SelectOption>
            </Select>
          </div>
          <div style="flex: 1">
            <div class="form-label">任务名</div>
            <Input v-model:value="editForm.name" :maxlength="64" placeholder="如：声音清单" />
          </div>
        </div>
        <div>
          <div class="form-label">玩法说明</div>
          <Textarea v-model:value="editForm.desc" :rows="3" :maxlength="255" show-count placeholder="孩子要做什么" />
        </div>
        <div>
          <div class="form-label">打卡要求（怎么拍）</div>
          <Textarea v-model:value="editForm.how" :rows="2" :maxlength="255" show-count placeholder="拍什么、怎么拍" />
        </div>
        <div class="pp-row" style="gap: 12px">
          <div>
            <div class="form-label">线下打卡点任务</div>
            <Switch v-model:checked="editForm.isOffline" />
          </div>
          <div style="flex: 1" v-if="editForm.isOffline">
            <div class="form-label">线下打卡点名称</div>
            <Input v-model:value="editForm.offlinePoint" :maxlength="32" placeholder="如：镜子游戏" />
          </div>
        </div>
        <span class="pp-caption">一天一个主题只有一项任务；老记录里存的是快照，改这里不影响历史数据。</span>
      </div>
    </Modal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { Table, Card, Tag, Button, Popconfirm, Modal, Input, Textarea, Select, SelectOption, Switch } from 'ant-design-vue';
import { adminApi } from '../../api.js';
import { THEMES, THEME_COLORS, mdText } from '../../utils.js';
import { toastErr, toastOk } from '../../toast.js';

const loading = ref(true);
const saving = ref(false);
const tasks = ref([]);
const themes = THEMES;

const totalDone = computed(() => tasks.value.reduce((n, t) => n + t.doneCount, 0));

const columns = [
  { title: '主题', key: 'theme', width: 100 },
  { title: '任务名', key: 'name', width: 170 },
  { title: '玩法', key: 'desc' },
  { title: '打卡要求', key: 'how' },
  { title: '已打卡', key: 'doneCount', align: 'right', width: 90 },
  { title: '操作', key: 'action', width: 150, fixed: 'right' },
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

// ------------------------------------------------------------------ 编辑

const editOpen = ref(false);
const editForm = reactive({ id: 0, date: '', theme: '', name: '', desc: '', how: '', isOffline: false, offlinePoint: '' });

function openEdit(record) {
  editForm.id = record.id;
  editForm.date = record.date;
  editForm.theme = record.theme;
  editForm.name = record.name;
  editForm.desc = record.desc;
  editForm.how = record.how;
  editForm.isOffline = record.isOffline;
  editForm.offlinePoint = record.offlinePoint || '';
  editOpen.value = true;
}

async function saveEdit() {
  if (!editForm.name.trim()) { toastErr('任务名不能为空'); return; }
  saving.value = true;
  try {
    await adminApi.updateTask(editForm.id, {
      theme: editForm.theme,
      name: editForm.name,
      desc: editForm.desc,
      how: editForm.how,
      isOffline: editForm.isOffline,
      offlinePoint: editForm.offlinePoint,
    });
    editOpen.value = false;
    toastOk('已保存，参与者端立即生效');
    await reload();
  } catch (e) {
    toastErr(e.message);
  } finally {
    saving.value = false;
  }
}

async function doReset(record) {
  try {
    await adminApi.resetTask(record.id);
    toastOk('已恢复默认内容');
    await reload();
  } catch (e) {
    toastErr(e.message);
  }
}

async function reload() {
  try {
    const data = await adminApi.tasks();
    tasks.value = data.tasks;
  } catch (e) {
    toastErr(e.message);
  }
}

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
.cell-text { font-size: 13px; color: #404040; line-height: 1.6; display: inline-block; max-width: 300px; }
.form-label { font-size: 12px; color: #888780; margin-bottom: 4px; }
</style>
