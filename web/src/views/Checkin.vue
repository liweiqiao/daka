<template>
  <ParticipantShell>
    <section class="o-section" style="flex: 1; padding-bottom: 0">
      <div class="o-container">
        <!-- 没登记过（或换了手机、清了缓存）：就地填这三项，填完原地继续打卡。
             打开链接就是打卡页，不再先跳一个"登记页"再跳回来。 -->
        <div v-if="needRegister" class="o-card o-card--pad-lg" style="max-width: 560px; margin: 0 auto">
          <div class="o-eyebrow">STEP 1</div>
          <h2 class="o-h2" style="margin-top: 8px">先填一次信息</h2>
          <p class="o-text-muted o-text-sm" style="margin-top: 10px; line-height: 1.7">
            姓名、学校、联系方式只填这一次，以后每天打开这个链接就直接打卡。
          </p>
          <div style="margin-top: 24px">
            <RegisterForm submit-text="填好了，去打卡" @registered="onRegistered" />
          </div>
        </div>

        <template v-else>
          <!-- 顶部：日期与进度 -->
          <div class="o-daybar">
            <div>
              <div class="o-eyebrow" style="margin-bottom: 6px">{{ todayText }}</div>
              <h1 class="o-h2">今天想做哪几件？</h1>
            </div>
            <div class="o-progress" v-if="progress">
              <span class="o-badge o-badge--success">今日 {{ todayDone }}/{{ taskList.length }} 项</span>
              <span class="o-badge o-badge--muted">累计 {{ progress.total }} 次</span>
              <span class="o-badge o-badge--muted">已覆盖 {{ progress.themesHit }}/7 主题</span>
            </div>
          </div>

          <p class="o-text-muted o-text-sm" style="margin-bottom: 20px; line-height: 1.7">
            挑一个做完就提交也行；想一次做几件，就多勾几个，最后一起传。
            <b>同一个主题一天只能打一次卡。</b>
          </p>

          <div v-if="notice" class="o-card" style="margin-bottom: 20px; border-left: 4px solid var(--color-glowstick)">
            <div class="o-label" style="margin-bottom: 4px">临时公告</div>
            <div class="o-text-sm" style="line-height: 1.7">{{ notice }}</div>
          </div>

          <div v-if="!inWindow" class="o-card" style="margin-bottom: 20px; border-left: 4px solid var(--color-heather)">
            <div class="o-label" style="margin-bottom: 4px">不在活动时间内</div>
            <div class="o-text-sm o-text-muted" style="line-height: 1.7">
              活动时间是 {{ dateRangeText }}。现在只能查看任务内容，等到了当天才能提交。
            </div>
          </div>

          <div v-if="!checkinOpen" class="o-card" style="margin-bottom: 20px; border-left: 4px solid var(--color-strawberry)">
            <div class="o-label" style="margin-bottom: 4px">打卡通道暂时关闭</div>
            <div class="o-text-sm o-text-muted" style="line-height: 1.7">
              活动方暂时关闭了提交入口，请稍后再试。
            </div>
          </div>

          <!-- 骨架屏：首次加载时不留白 -->
          <div v-if="loading" class="o-tasks">
            <div v-for="i in 6" :key="i" class="o-skel" style="height: 168px"></div>
          </div>

          <div v-else class="o-tasks">
            <div
              v-for="task in taskList"
              :key="task.id"
              class="o-task"
              :class="{ 'is-open': isOpen(task), 'is-done': task.done }"
            >
              <div class="o-task__head">
                <span class="o-task__theme">{{ task.theme }}</span>
                <span v-if="task.isOffline" class="o-badge o-badge--warn">线下打卡点</span>
                <span v-if="task.done" class="o-badge o-badge--success" style="margin-left: auto">今天已完成</span>
              </div>

              <div class="o-task__name">{{ task.name }}</div>
              <div class="o-task__desc">{{ task.desc }}</div>

              <div v-if="task.isOffline && task.offlinePoint" class="o-task__how">
                <b>打卡点：</b>{{ task.offlinePoint }}
              </div>
              <div class="o-task__how"><b>打卡指引：</b>{{ task.how }}</div>

              <!-- 已打过卡：只展示，不允许再选 -->
              <div v-if="task.done" class="o-task__foot">
                <span class="o-text-caption o-text-muted">这一项今天已经打卡，明天再来</span>
              </div>

              <!-- 非活动期预览：只看内容，不开放选择 -->
              <div v-else-if="previewMode" class="o-task__foot">
                <span class="o-text-caption o-text-muted">活动开始后开放打卡</span>
              </div>

              <div v-else class="o-task__foot">
                <button class="o-btn o-btn--ghost o-btn--sm no-select" type="button" @click="toggle(task)">
                  <span class="o-check" :class="{ 'is-on': isOpen(task) }"></span>
                  {{ isOpen(task) ? '已加入本次提交' : '选这一项' }}
                </button>
              </div>

              <!-- 展开区：上传凭证 -->
              <div v-if="isOpen(task) && !task.done" class="o-task__panel">
                <hr class="o-hr" style="margin: 4px 0 16px" />
                <MediaUploader
                  v-model="sel[task.id].media"
                  :limits="limits"
                  :task-id="task.id"
                  @busy="(b) => (busyMap[task.id] = b)"
                />
                <div class="o-field" style="margin-top: 20px">
                  <label class="o-label" :for="`rm-${task.id}`">想说的话（选填）</label>
                  <textarea
                    :id="`rm-${task.id}`"
                    v-model="sel[task.id].remark"
                    class="o-textarea"
                    maxlength="200"
                    placeholder="孩子今天说了什么、有什么好玩的细节，写下来活动方会看到"
                  ></textarea>
                </div>
                <button class="o-btn o-btn--ghost o-btn--sm" type="button" @click="toggle(task)">
                  收起
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </section>

    <!-- 吸底提交条：只在有选中项时出现 -->
    <div v-if="isRegistered && selectedCount > 0" class="o-stickybar">
      <div class="o-container o-stickybar__inner">
        <div>
          <div class="o-text-sm" style="font-weight: 600">已选 {{ selectedCount }} 项</div>
          <div class="o-text-caption o-text-muted">{{ selectedThemesText }}</div>
        </div>
        <button class="o-btn o-btn--primary" type="button" :disabled="submitting || anyUploading" @click="submit">
          <span v-if="submitting" class="o-loading"></span>
          {{ submitting ? '提交中…' : (anyUploading ? '文件还在上传…' : '提交打卡') }}
        </button>
      </div>
    </div>

    <!-- 提交结果 -->
    <Modal :open="result.open" :title="result.title" @close="afterResult">
      <div v-if="result.accepted.length" style="margin-bottom: 16px">
        <div class="o-badge o-badge--success">成功计入 {{ result.accepted.length }} 项</div>
        <ul class="res-list">
          <li v-for="a in result.accepted" :key="a.taskId">
            <b>{{ a.theme }}</b> · {{ a.taskName }}
          </li>
        </ul>
      </div>

      <div v-if="result.skipped.length">
        <div class="o-badge o-badge--warn">未计入 {{ result.skipped.length }} 项</div>
        <ul class="res-list">
          <li v-for="(s, i) in result.skipped" :key="i">
            <b>{{ s.theme || '未知' }}</b><span v-if="s.taskName"> · {{ s.taskName }}</span>
            <span class="o-text-muted"> —— {{ s.message }}</span>
          </li>
        </ul>
      </div>

      <p v-if="result.progress" class="o-text-sm o-text-muted" style="margin-top: 16px; line-height: 1.7">
        累计已打卡 {{ result.progress.total }} 次，覆盖 {{ result.progress.themesHit }}/7 个主题。
        <span v-if="result.progress.nextHonor">
          下一个荣誉「{{ result.progress.nextHonor.name }}」{{ result.progress.nextHonor.need }}。
        </span>
      </p>

      <template #footer>
        <button class="o-btn o-btn--ghost" @click="afterResult">继续打卡</button>
        <router-link to="/records" class="o-btn o-btn--primary">看我的记录</router-link>
      </template>
    </Modal>

    <!-- 有选中项但没传照片：先说清楚，再让用户决定 -->
    <Modal :open="confirmMissing.open" title="有几项还没传照片" @close="confirmMissing.open = false">
      <p class="o-text-sm" style="line-height: 1.8">
        照片是必填项。下面这几项没有照片，提交后不会被计入：
      </p>
      <ul class="res-list">
        <li v-for="t in confirmMissing.tasks" :key="t.id"><b>{{ t.theme }}</b> · {{ t.name }}</li>
      </ul>
      <p class="o-text-sm o-text-muted" style="line-height: 1.8; margin-top: 12px">
        可以直接提交只算有照片的那几项，也可以回去把它们补齐。
      </p>
      <template #footer>
        <button class="o-btn o-btn--ghost" @click="confirmMissing.open = false">回去补照片</button>
        <button class="o-btn o-btn--primary" @click="doSubmit">只提交有照片的</button>
      </template>
    </Modal>
  </ParticipantShell>
</template>

<script setup>
/**
 * Checkin.vue —— 打卡主流程。
 *
 * 交互设计要点：
 *   1. 一天内既能"选一项就提交"，也能"多选后集中提交"，所以勾选与上传是分离的：
 *      勾选只是把卡片展开，真正提交时统一收集。
 *   2. 已经打过的主题在服务端返回的 done 标记下直接置灰，从源头避免无效提交。
 *   3. 提交前先在本地查一遍"有没有照片"，把结果说清楚，
 *      而不是让用户提交完才发现有几项被静默过滤掉。
 *   4. requestId 在进入页面时生成一次并复用：微信里网络抖动导致的重发会被后端幂等吃掉。
 */
import { reactive, ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import ParticipantShell from '../components/ParticipantShell.vue';
import Modal from '../components/Modal.vue';
import MediaUploader from '../components/MediaUploader.vue';
import RegisterForm from '../components/RegisterForm.vue';
import { api } from '../api.js';
import { state, hasToken, isRegistered, loadMe, loadActivity, loadTaskDict, applyProgress, markDoneThemes } from '../appstate.js';
import { uuid, mdText } from '../utils.js';
import { toastOk, toastErr, toastWarn } from '../toast.js';

const router = useRouter();

const loading = ref(true);
const checking = ref(true);
const submitting = ref(false);
const taskList = ref([]);
const sel = reactive({});            // taskId -> { media: [], remark: '' }
const openIds = ref(new Set());
const busyMap = reactive({});
const requestId = ref(uuid());

const result = reactive({ open: false, title: '', accepted: [], skipped: [], progress: null });
const confirmMissing = reactive({ open: false, tasks: [] });

const act = computed(() => state.activity || {});
/**
 * 要不要就地填信息：
 *   判据是"本地有没有 token + 服务端认不认"，不是 state.me 加载了没。
 *   刷新页面时 state.me 必然是 null，用它判断会把已经登记过的家长挡在门外。
 */
const needRegister = computed(() => !checking.value && !isRegistered.value);
const limits = computed(() => act.value.limits || {
  photoMaxMB: 10, videoMaxMB: 30, videoMaxSec: 90, photoMaxCount: 9, videoMaxCount: 1,
});
const progress = computed(() => (state.me && state.me.progress) || null);
const todayDone = computed(() => taskList.value.filter((t) => t.done).length);
const notice = computed(() => act.value.notice || '');
const checkinOpen = computed(() => act.value.checkinOpen !== false);
const inWindow = computed(() => {
  const t = state.me && state.me.today;
  return t ? t.inActivity : true;
});
/** 非活动期 = 预览态：任务卡只展示内容，不开放勾选/上传（提交会被服务端窗口校验拒绝） */
const previewMode = computed(() => !inWindow.value);

const todayText = computed(() => {
  const t = state.me && state.me.today;
  if (!t) return '';
  return `${mdText(t.date)} ${t.weekday}`;
});

const dateRangeText = computed(() => {
  const d = act.value.dates || [];
  return d.length ? `${mdText(d[0])} — ${mdText(d[d.length - 1])}` : '';
});

const selectedIds = computed(() => taskList.value.filter((t) => openIds.value.has(t.id) && !t.done).map((t) => t.id));
const selectedCount = computed(() => selectedIds.value.length);
const selectedThemesText = computed(() =>
  taskList.value.filter((t) => openIds.value.has(t.id) && !t.done).map((t) => t.theme).join('、')
);
const anyUploading = computed(() => Object.values(busyMap).some(Boolean));

function isOpen(task) { return openIds.value.has(task.id); }

function toggle(task) {
  if (task.done) return;
  const next = new Set(openIds.value);
  if (next.has(task.id)) {
    next.delete(task.id);
  } else {
    next.add(task.id);
    if (!sel[task.id]) sel[task.id] = { media: [], remark: '' };
  }
  openIds.value = next;
}

// ---------------------------------------------------------------- 加载

async function load() {
  loading.value = true;
  try {
    await loadActivity();
  } catch (e) { /* 活动信息拿不到也继续，页面有兜底默认值 */ }

  // 判据是「本地有没有 token」，不是「state.me 加载了没」——
  // 刚刷新页面时 state.me 必然是 null，用它判断会直接把人挡在门外
  if (!hasToken.value) {
    checking.value = false;
    loading.value = false;
    return;
  }

  try {
    await loadMe();
    // 有 token 但服务端不认（换了库、token 过期、记录被删）→ 走重新登记
    if (!state.me) {
      checking.value = false;
      loading.value = false;
      return;
    }
    let data = await api.myTasks();
    // 非活动期当天查不到任何任务行，列表会整页空白，刚登记的家长会以为系统坏了。
    // 改成拉「最近的那个活动日」的任务做只读预览（活动前看首日、活动后看末日），
    // 日期全部取自后台动态配置，不写死；预览态卡片由模板里的 previewMode 置为只读。
    if (!data.tasks?.length && previewMode.value && act.value.dates && act.value.dates.length) {
      const dates = act.value.dates;
      const todayStr = (state.me.today && state.me.today.date) || state.today || '';
      const previewDate = todayStr && todayStr < dates[0] ? dates[0] : dates[dates.length - 1];
      try {
        const preview = await api.myTasks(previewDate);
        if (preview.tasks && preview.tasks.length) data = preview;
      } catch (e) { /* 预览拉不到就维持空列表，上面的提示卡已兜底 */ }
    }
    taskList.value = data.tasks || [];
    taskList.value.forEach((t) => {
      if (!sel[t.id]) sel[t.id] = { media: [], remark: '' };
    });
  } catch (e) {
    toastErr(e.message);
  } finally {
    checking.value = false;
    loading.value = false;
  }
}

onMounted(load);

/** 就地登记完成：token 已经落地，重新走一遍加载，页面自己会切成打卡视图 */
async function onRegistered() {
  await load();
}

// 从别处回来时刷新一下"今天做了什么"，避免显示出过期的状态
watch(() => state.me && state.me.progress && state.me.progress.total, () => {
  taskList.value.forEach((t) => {
    if (state.me && state.me.today && state.me.today.tasks) {
      const m = state.me.today.tasks.find((x) => x.id === t.id);
      if (m) t.done = m.done;
    }
  });
});

// ---------------------------------------------------------------- 提交

function collectedItems({ onlyWithPhoto }) {
  const items = [];
  for (const id of selectedIds.value) {
    const task = taskList.value.find((t) => t.id === id);
    const bucket = sel[id] || { media: [], remark: '' };
    const done = bucket.media.filter((m) => m.state === 'done' && m.key);
    const photos = done.filter((m) => m.type === 'image');
    if (onlyWithPhoto && !photos.length) continue;
    items.push({
      taskId: id,
      remark: bucket.remark || '',
      media: done.map((m) => ({ type: m.type, key: m.key })),
      _task: task,
    });
  }
  return items;
}

async function submit() {
  if (submitting.value) return;

  // 校验 1：还有文件在传
  if (anyUploading.value) {
    toastWarn('还有文件正在上传，等它传完再提交');
    return;
  }
  // 校验 2：有失败的文件
  const failed = selectedIds.value.filter((id) => (sel[id].media || []).some((m) => m.state === 'error'));
  if (failed.length) {
    const names = failed.map((id) => taskList.value.find((t) => t.id === id).theme).join('、');
    toastErr(`${names} 有文件上传失败，请删掉重传或换小一点的文件`);
    return;
  }

  // 校验 3：没照片的项。不直接拦死，让用户自己决定
  const missing = selectedIds.value.filter((id) => {
    const done = (sel[id].media || []).filter((m) => m.state === 'done' && m.key);
    return !done.some((m) => m.type === 'image');
  });
  if (missing.length) {
    confirmMissing.tasks = missing.map((id) => {
      const t = taskList.value.find((x) => x.id === id);
      return { id, theme: t.theme, name: t.name };
    });
    confirmMissing.open = true;
    return;
  }

  await doSubmit();
}

async function doSubmit() {
  confirmMissing.open = false;

  const items = collectedItems({ onlyWithPhoto: false });
  if (!items.length) { toastWarn('没有可提交的内容'); return; }

  submitting.value = true;
  try {
    const data = await api.checkin({
      requestId: requestId.value,
      items: items.map(({ taskId, remark, media }) => ({ taskId, remark, media })),
    });

    if (data.progress) applyProgress(data.progress);
    if (data.accepted && data.accepted.length) {
      markDoneThemes(data.accepted.map((a) => a.theme));
      // 成功的项清掉本地上传列表，避免"已经提交了还挂在待提交区"
      data.accepted.forEach((a) => {
        if (sel[a.taskId]) { sel[a.taskId].media = []; sel[a.taskId].remark = ''; }
        openIds.value.delete(a.taskId);
      });
      openIds.value = new Set(openIds.value);
    }

    result.open = true;
    result.title = data.replay ? '这次提交已经记过了' : (data.accepted.length ? '打卡成功' : '没有新增打卡');
    result.accepted = data.accepted || [];
    result.skipped = data.skipped || [];
    result.progress = data.progress || null;

    // 幂等键只对"这一次提交"有效：换新的提交必须换新的 key，
    // 否则第二次提交会被后端当成重发直接回放上次结果
    requestId.value = uuid();

    if (result.accepted.length) toastOk(data.message || '打卡成功');
    else toastWarn(data.message || '这次没有计入任何打卡');

    // 刷新一次，把服务端的 done 状态同步回来
    try {
      await loadMe(true);
      const fresh = await api.myTasks();
      taskList.value = fresh.tasks || [];
    } catch (e) { /* 刷新失败不影响主流程，页面本地态已经更新 */ }
  } catch (e) {
    toastErr(e.message);
  } finally {
    submitting.value = false;
  }
}

function afterResult() {
  result.open = false;
}
</script>

<style scoped>
.o-task__panel { margin-top: 8px; }
.res-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}
.res-list li {
  font-size: var(--text-body-sm);
  line-height: 1.6;
  padding-left: 14px;
  position: relative;
}
.res-list li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 9px;
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--color-smoke);
}
</style>
