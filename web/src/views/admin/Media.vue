<template>
  <div style="display: flex; flex-direction: column; gap: 20px">
    <!-- 空间概览 -->
    <div class="pp-grid pp-grid--4">
      <div class="pp-kpi">
        <div class="pp-kpi__label">文件总数</div>
        <div class="pp-kpi__value">{{ n(sm.totalCount) }}</div>
        <div class="pp-kpi__foot">{{ n(sm.photos) }} 张照片 · {{ n(sm.videos) }} 段视频</div>
      </div>
      <div class="pp-kpi">
        <div class="pp-kpi__label">已占用空间</div>
        <div class="pp-kpi__value">{{ sm.totalMB }}<span class="pp-kpi__unit">MB</span></div>
        <div class="pp-kpi__foot">含未提交的临时文件</div>
      </div>
      <div class="pp-kpi" :class="{ 'pp-kpi--dark': sm.orphanCount > 0 }">
        <div class="pp-kpi__label">待清理（上传未提交）</div>
        <div class="pp-kpi__value">{{ n(sm.orphanCount) }}</div>
        <div class="pp-kpi__foot">约 {{ sm.orphanMB }} MB 可以回收</div>
      </div>
      <div class="pp-kpi">
        <div class="pp-kpi__label">已归档凭证</div>
        <div class="pp-kpi__value">{{ n(sm.boundCount) }}</div>
        <div class="pp-kpi__foot">已绑定到打卡记录</div>
      </div>
    </div>

    <!-- 运维提示：七牛免费额度 / 本地磁盘都靠这个动作保命 -->
    <div class="pp-card pp-card--mist pp-card--pad-sm">
      <div class="pp-row">
        <span class="pp-badge pp-badge--new">每日必做</span>
        <span class="pp-caption" style="flex: 1; min-width: 240px">
          先「导出当天附件」存档，再点「清理未提交的文件」，空间就能循环使用。
          七牛免费额度只有 10GB，1000 人 7 天不收着用一定超。
        </span>
      </div>
    </div>

    <!-- 筛选与操作 -->
    <div class="pp-card pp-card--pad-sm">
      <div class="pp-filters">
        <select v-model="q.status" class="pp-select pp-input--sm" style="width: auto" @change="go(1)">
          <option value="1">已绑定（归档）</option>
          <option value="0">待清理（上传未提交）</option>
          <option value="all">全部文件</option>
        </select>
        <input v-model="q.date" class="pp-input pp-input--sm" type="date" @change="go(1)" />
        <template v-if="q.status === '0'">
          <select v-model.number="q.minutes" class="pp-select pp-input--sm" style="width: auto" @change="go(1)">
            <option :value="60">超过 1 小时未提交</option>
            <option :value="120">超过 2 小时未提交</option>
            <option :value="720">超过 12 小时未提交</option>
            <option :value="1440">超过 1 天未提交</option>
          </select>
        </template>

        <div class="pp-spacer"></div>

        <button class="pp-btn pp-btn--outline pp-btn--sm" type="button" :disabled="busy" @click="refresh">刷新</button>
      </div>
    </div>

    <!-- 导出与清理 -->
    <div class="pp-grid pp-grid--2">
      <div class="pp-card">
        <h3 class="pp-h3">导出附件</h3>
        <p class="pp-lead" style="margin-top: 8px; margin-bottom: 16px">
          打包成 zip 下载存档。<b>建议一天一天导</b>——一次导 300 个文件就是几十 MB，
          手机上会很难受，服务器也容易被拉满。
        </p>
        <div class="pp-row">
          <input v-model="zipDate" class="pp-input pp-input--sm" style="width: auto" type="date" />
          <select v-model.number="zipMax" class="pp-select pp-input--sm" style="width: auto">
            <option :value="100">最多 100 个</option>
            <option :value="300">最多 300 个</option>
            <option :value="800">最多 800 个</option>
          </select>
          <button class="pp-btn pp-btn--sm" type="button" :disabled="busy" @click="exportZip">
            {{ busy ? '打包中…' : '打包下载' }}
          </button>
          <button class="pp-btn pp-btn--outline pp-btn--sm" type="button" :disabled="busy" @click="exportManifest">
            导出清单 CSV
          </button>
        </div>
      </div>

      <div class="pp-card">
        <h3 class="pp-h3">清理未提交的文件</h3>
        <p class="pp-lead" style="margin-top: 8px; margin-bottom: 16px">
          参与者传了文件但没点提交的，会一直占着空间。清理只删「从未绑定到任何打卡记录」的文件，
          不影响已经归档的凭证。
        </p>
        <div class="pp-row">
          <select v-model.number="cleanupHours" class="pp-select pp-input--sm" style="width: auto">
            <option :value="6">超过 6 小时</option>
            <option :value="24">超过 24 小时</option>
            <option :value="72">超过 3 天</option>
          </select>
          <button class="pp-btn pp-btn--outline pp-btn--sm" type="button" :disabled="busy" @click="doCleanup(true)">先试算</button>
          <button class="pp-btn pp-btn--dark pp-btn--sm" type="button" :disabled="busy" @click="doCleanup(false)">确认清理</button>
        </div>
        <p v-if="cleanupResult" class="pp-caption" style="margin-top: 12px">{{ cleanupResult }}</p>
      </div>
    </div>

    <!-- 列表 -->
    <div v-if="loading" class="pp-card">
      <div v-for="i in 4" :key="i" class="pp-skel" style="height: 40px; margin-bottom: 8px"></div>
    </div>

    <div v-else-if="!list.length" class="pp-card pp-empty">没有符合条件的文件</div>

    <template v-else>
      <div class="pp-row">
        <span class="pp-badge pp-badge--blue">共 {{ n(total) }} 个</span>
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
              <span class="pp-badge" :class="m.status === 1 ? 'pp-badge--done' : 'pp-badge--warn'">
                {{ m.status === 1 ? '已归档' : '待清理' }}
              </span>
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
    <div v-if="confirmOpen" class="pp-mask" @click.self="confirmOpen = false">
      <div class="pp-modal" style="max-width: 480px">
        <div class="pp-modal__head">
          <h3 class="pp-h3">确认清理孤儿文件？</h3>
          <button class="pp-modal__close" type="button" @click="confirmOpen = false">×</button>
        </div>
        <p class="pp-lead">
          将删除 {{ cleanupPreview.candidates }} 个「上传后从未提交」的文件，约 {{ cleanupPreview.sizeMB }} MB。
          这些文件不挂在任何打卡记录上，删除后不影响已归档的凭证。
        </p>
        <p class="pp-caption" style="margin-top: 12px">操作会记入后台日志，删除不可撤销。</p>
        <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px">
          <button class="pp-btn pp-btn--outline pp-btn--sm" type="button" @click="confirmOpen = false">取消</button>
          <button class="pp-btn pp-btn--dark pp-btn--sm" type="button" :disabled="busy" @click="doCleanup(false, true)">
            {{ busy ? '清理中…' : '确认删除' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue';
import { Pagination } from 'ant-design-vue';
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
