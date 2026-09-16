<template>
  <div style="display: flex; flex-direction: column; gap: 20px">
    <!-- 空间概览 -->
    <div class="pp-grid pp-grid--4">
      <Card class="dub-kpi" :body-style="{ padding: '20px' }">
        <div class="dub-kpi__label">文件总数</div>
        <div class="dub-kpi__value">{{ n(sm.totalCount) }}</div>
        <div class="dub-kpi__foot">{{ n(sm.photos) }} 张照片 · {{ n(sm.videos) }} 段视频</div>
      </Card>
      <Card class="dub-kpi" :body-style="{ padding: '20px' }">
        <div class="dub-kpi__label">已占用空间</div>
        <div class="dub-kpi__value">{{ sm.totalMB }}<span class="dub-kpi__unit">MB</span></div>
        <div class="dub-kpi__foot">含未提交的临时文件</div>
      </Card>
      <Card class="dub-kpi" :body-style="{ padding: '20px' }" :class="{ 'dub-kpi--dark': sm.orphanCount > 0 }">
        <div class="dub-kpi__label">待清理（上传未提交）</div>
        <div class="dub-kpi__value">{{ n(sm.orphanCount) }}</div>
        <div class="dub-kpi__foot">约 {{ sm.orphanMB }} MB 可以回收</div>
      </Card>
      <Card class="dub-kpi" :body-style="{ padding: '20px' }">
        <div class="dub-kpi__label">已归档凭证</div>
        <div class="dub-kpi__value">{{ n(sm.boundCount) }}</div>
        <div class="dub-kpi__foot">已绑定到打卡记录</div>
      </Card>
    </div>

    <!-- 运维提示 -->
    <Card class="dub-card--mist" :body-style="{ padding: '20px' }">
      <div class="pp-row">
        <Tag class="dub-tag--new">每日必做</Tag>
        <span class="pp-caption" style="flex: 1; min-width: 240px">
          先「导出当天附件」存档，再点「清理未提交的文件」，空间就能循环使用。
          七牛免费额度只有 10GB，1000 人 7 天不收着用一定超。
        </span>
      </div>
    </Card>

    <!-- 筛选与操作 -->
    <Card :body-style="{ padding: '20px' }">
      <div class="pp-filters">
        <Select v-model:value="q.status" size="small" @change="go(1)">
          <Select-Option value="1">已绑定（归档）</Select-Option>
          <Select-Option value="0">待清理（上传未提交）</Select-Option>
          <Select-Option value="all">全部文件</Select-Option>
        </Select>
        <DatePicker v-model:value="q.date" size="small" value-format="YYYY-MM-DD" @change="go(1)" />
        <template v-if="q.status === '0'">
          <Select v-model:value="q.minutes" size="small" @change="go(1)">
            <Select-Option :value="60">超过 1 小时未提交</Select-Option>
            <Select-Option :value="120">超过 2 小时未提交</Select-Option>
            <Select-Option :value="720">超过 12 小时未提交</Select-Option>
            <Select-Option :value="1440">超过 1 天未提交</Select-Option>
          </Select>
        </template>

        <div class="pp-spacer"></div>

        <Button size="small" :disabled="busy" @click="refresh">刷新</Button>
      </div>
    </Card>

    <!-- 导出与清理 -->
    <div class="pp-grid pp-grid--2">
      <Card :body-style="{ padding: '20px' }">
        <h3 class="pp-h3">导出附件</h3>
        <p class="pp-lead" style="margin-top: 8px; margin-bottom: 16px">
          打包成 zip 下载存档。<b>建议一天一天导</b>——一次导 300 个文件就是几十 MB，
          手机上会很难受，服务器也容易被拉满。
        </p>
        <div class="pp-row">
          <DatePicker v-model:value="zipDate" size="small" value-format="YYYY-MM-DD" />
          <Select v-model:value="zipMax" size="small">
            <Select-Option :value="100">最多 100 个</Select-Option>
            <Select-Option :value="300">最多 300 个</Select-Option>
            <Select-Option :value="800">最多 800 个</Select-Option>
          </Select>
          <Button size="small" :disabled="busy" @click="exportZip">
            {{ busy ? '打包中…' : '打包下载' }}
          </Button>
          <Button size="small" :disabled="busy" @click="exportManifest">导出清单 CSV</Button>
        </div>
      </Card>

      <Card :body-style="{ padding: '20px' }">
        <h3 class="pp-h3">清理未提交的文件</h3>
        <p class="pp-lead" style="margin-top: 8px; margin-bottom: 16px">
          参与者传了文件但没点提交的，会一直占着空间。清理只删「从未绑定到任何打卡记录」的文件，
          不影响已经归档的凭证。
        </p>
        <div class="pp-row">
          <Select v-model:value="cleanupHours" size="small">
            <Select-Option :value="6">超过 6 小时</Select-Option>
            <Select-Option :value="24">超过 24 小时</Select-Option>
            <Select-Option :value="72">超过 3 天</Select-Option>
          </Select>
          <Button size="small" :disabled="busy" @click="doCleanup(true)">先试算</Button>
          <Button type="primary" size="small" :disabled="busy" @click="doCleanup(false)">确认清理</Button>
        </div>
        <p v-if="cleanupResult" class="pp-caption" style="margin-top: 12px">{{ cleanupResult }}</p>
      </Card>
    </div>

    <!-- 列表 -->
    <Card v-if="loading">
      <div v-for="i in 4" :key="i" class="pp-skel" style="height: 40px; margin-bottom: 8px"></div>
    </Card>

    <Card v-else-if="!list.length" class="pp-empty">没有符合条件的文件</Card>

    <template v-else>
      <div class="pp-row">
        <Tag class="dub-tag--blue">共 {{ n(total) }} 个</Tag>
        <span class="pp-caption">第 {{ page }} / {{ Math.max(1, pages) }} 页</span>
      </div>

      <div class="pp-media-grid">
        <div v-for="m in list" :key="m.id" class="pp-media">
          <div class="pp-media__box">
            <video v-if="m.type === 'video' && m.url" :src="m.url" controls preload="metadata"></video>
            <a v-else-if="m.url" :href="m.url" target="_blank" rel="noopener">
              <img :src="m.url" alt="附件" loading="lazy" />
            </a>
            <div v-else class="nourl">
              <span>{{ m.status === 1 ? '链接生成失败' : '未归档' }}</span>
            </div>
          </div>
          <div class="pp-media__meta">
            <div class="pp-row" style="gap: 6px">
              <Tag :class="m.status === 1 ? 'dub-tag--done' : 'dub-tag--warn'">
                {{ m.status === 1 ? '已归档' : '待清理' }}
              </Tag>
              <span>{{ m.sizeMB }} MB</span>
            </div>
            <div style="margin-top: 6px">
              <div v-if="m.participant">{{ m.participant.name }} · {{ m.participant.school }}</div>
              <div v-if="m.checkin" class="pp-caption">{{ mdText(m.checkin.date) }} · {{ m.checkin.theme }}</div>
            </div>
            <div class="pp-mono" style="margin-top: 6px; word-break: break-all; color: #666">{{ m.key }}</div>
          </div>
        </div>
      </div>

      <Pagination
        :current="page"
        :page-size="pageSize"
        :total="total"
        :show-size-changer="true"
        :page-size-options="['30', '60', '120']"
        :show-total="(t) => `共 ${t} 个文件`"
        style="margin-top: 20px; text-align: right"
        @change="onPageChange"
        @showSizeChange="onPageChange"
      />
    </template>

    <!-- 确认清理 -->
    <Modal v-model:open="confirmOpen" title="确认清理孤儿文件？" :footer="null">
      <p class="pp-lead">
        将删除 {{ cleanupPreview.candidates }} 个「上传后从未提交」的文件，约 {{ cleanupPreview.sizeMB }} MB。
        这些文件不挂在任何打卡记录上，删除后不影响已归档的凭证。
      </p>
      <p class="pp-caption" style="margin-top: 12px">操作会记入后台日志，删除不可撤销。</p>
      <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px">
        <Button size="small" @click="confirmOpen = false">取消</Button>
        <Button type="primary" size="small" :disabled="busy" @click="doCleanup(false, true)">
          {{ busy ? '清理中…' : '确认删除' }}
        </Button>
      </div>
    </Modal>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue';
import { Pagination, Card, Button, Input, Select, SelectOption, DatePicker, Tag, Modal } from 'ant-design-vue';
import { adminApi, download } from '../../api.js';
import { mdText } from '../../utils.js';
import { toastOk, toastErr, toastWarn } from '../../toast.js';

const q = reactive({ status: '1', date: '', minutes: 120 });
const page = ref(1);
const pageSize = ref(60);
const total = ref(0);
const pages = ref(1);
const list = ref([]);
const loading = ref(true);
const busy = ref(false);
const cleanupResult = ref('');
const cleanupHours = ref(24);
const cleanupPreview = reactive({ candidates: 0, sizeMB: 0 });
const confirmOpen = ref(false);
const zipDate = ref('');
const zipMax = ref(300);

const sm = reactive({ totalCount: 0, totalMB: 0, orphanCount: 0, orphanMB: 0, boundCount: 0, photos: 0, videos: 0 });

function n(v) { return Number(v || 0).toLocaleString('zh-CN'); }

async function load() {
  busy.value = true;
  loading.value = true;
  try {
    const data = await adminApi.media({
      status: q.status,
      date: q.date || undefined,
      minutes: q.status === '0' ? q.minutes : undefined,
      page: page.value,
      pageSize: pageSize.value,
    });
    list.value = data.list;
    total.value = Number(data.total || data.list.length);
    pages.value = data.pages || 1;
    Object.assign(sm, data.summary || {});
  } catch (e) {
    toastErr(e.message);
  } finally {
    busy.value = false;
    loading.value = false;
  }
}

function go(p) {
  page.value = Math.min(Math.max(1, p), Math.max(1, pages.value));
  load();
}

/** a-v 的 Pagination 翻页和改每页条数都走这一个回调 */
function onPageChange(p, size) {
  page.value = p;
  if (size && size !== pageSize.value) { pageSize.value = size; page.value = 1; }
  load();
}
async function refresh() { await load(); }

/** 试算：只数不删，先让运营心里有数 */
async function doCleanup(dryRun, confirmed = false) {
  if (!dryRun && !confirmed) {
    busy.value = true;
    try {
      const p = await adminApi.cleanupMedia({ olderThanHours: cleanupHours.value, dryRun: true, limit: 2000 });
      cleanupPreview.candidates = p.candidates;
      cleanupPreview.sizeMB = p.sizeMB;
      if (!p.candidates) { toastWarn('没有可清理的文件'); return; }
      confirmOpen.value = true;
    } catch (e) {
      toastErr(e.message);
    } finally {
      busy.value = false;
    }
    return;
  }

  busy.value = true;
  try {
    const r = await adminApi.cleanupMedia({ olderThanHours: cleanupHours.value, dryRun, limit: 2000 });
    if (dryRun) {
      cleanupResult.value = `试算：有 ${r.candidates} 个文件可清理，约 ${r.sizeMB} MB`;
      toastOk(cleanupResult.value);
    } else {
      cleanupResult.value = r.message || `已清理 ${r.removed} 个文件`;
      toastOk(cleanupResult.value);
      confirmOpen.value = false;
      await load();
    }
  } catch (e) {
    toastErr(e.message);
  } finally {
    busy.value = false;
  }
}

async function exportZip() {
  busy.value = true;
  try {
    const r = await download('/api/admin/export/media.zip', { date: zipDate.value || undefined, maxFiles: zipMax.value }, '打卡凭证.zip');
    toastOk(`已打包 ${r.entries} 个附件${r.skipped ? `，跳过 ${r.skipped} 个` : ''}${r.truncated ? '（已达上限，请再导一次）' : ''}`);
  } catch (e) {
    toastErr(e.message);
  } finally {
    busy.value = false;
  }
}

async function exportManifest() {
  busy.value = true;
  try {
    const r = await download('/api/admin/export/media', { date: zipDate.value || undefined }, '附件清单.csv');
    toastOk(`已导出 ${r.name}`);
  } catch (e) {
    toastErr(e.message);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.nourl {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: #666;
}
</style>
