<template>
  <ConfigProvider :theme="ppTheme" :locale="ppLocale">
    <div class="pp pp-antd pp-shell">
    <!-- 侧栏 -->
    <aside class="pp-side">
      <div class="pp-brand">
        <span class="pp-brand__mark"></span>
        <div>
          <div class="pp-brand__text">清城少年志</div>
          <div class="pp-brand__sub">打卡统计后台</div>
        </div>
      </div>

      <nav class="pp-nav">
        <router-link
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="pp-nav__item"
          active-class="is-active"
        >
          <span class="pp-nav__dot"></span>
          <span>{{ item.label }}</span>
          <span v-if="item.badge" class="pp-nav__badge">{{ item.badge }}</span>
        </router-link>
      </nav>

      <div class="pp-side__foot">
        <div v-if="meta.today">今天是 {{ meta.today }}</div>
        <div v-if="meta.dayIndex">活动第 {{ meta.dayIndex }} / {{ meta.totalDays }} 天</div>
        <div v-if="meta.driver" style="margin-top: 6px">
          存储驱动：{{ meta.driver === 'qiniu' ? '七牛云' : '本地磁盘' }}
        </div>
      </div>
    </aside>

    <!-- 主区 -->
    <main class="pp-main">
      <header class="pp-top">
        <div>
          <div class="pp-top__title">{{ title }}</div>
          <div class="pp-top__meta">{{ subtitle }}</div>
        </div>

        <div class="pp-top__right">
          <router-link to="/" target="_blank" class="pp-btn pp-btn--outline pp-btn--sm">看家长端</router-link>
          <button class="pp-btn pp-btn--ghost pp-btn--sm" type="button" @click="changePwdOpen = true">改密码</button>
          <button class="pp-btn pp-btn--dark pp-btn--sm" type="button" @click="logout">退出</button>
        </div>
      </header>

      <div class="pp-body">
        <!-- 演练模式提醒：只有服务端开了"模拟日期"才会出现 -->
        <div v-if="meta.simulated" class="pp-simbar">
          演练模式 · 后台所有「今天」按 {{ meta.simulated }} 计算，正式活动请关掉 DAKA_ALLOW_CLOCK_OVERRIDE
        </div>

        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </div>
    </main>

    <!-- 改密码 -->
    <div v-if="changePwdOpen" class="pp-mask" @click.self="changePwdOpen = false">
      <div class="pp-modal" style="max-width: 440px">
        <div class="pp-modal__head">
          <h3 class="pp-h3">修改密码</h3>
          <button class="pp-modal__close" type="button" @click="changePwdOpen = false">×</button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 16px">
          <div class="pp-field">
            <label class="pp-label" for="p-old">原密码</label>
            <input id="p-old" v-model="pwd.oldPassword" class="pp-input" type="password" autocomplete="current-password" />
          </div>
          <div class="pp-field">
            <label class="pp-label" for="p-new">新密码</label>
            <input id="p-new" v-model="pwd.newPassword" class="pp-input" type="password" autocomplete="new-password" />
            <span class="pp-caption">至少 8 位，且同时包含字母和数字</span>
          </div>
          <div style="display: flex; gap: 12px; justify-content: flex-end">
            <button class="pp-btn pp-btn--outline pp-btn--sm" type="button" @click="changePwdOpen = false">取消</button>
            <button class="pp-btn pp-btn--sm" type="button" :disabled="pwdBusy" @click="submitPwd">
              {{ pwdBusy ? '提交中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </div>
    </div>
  </ConfigProvider>
</template>

<script setup>
import { computed, reactive, ref, onBeforeUnmount, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ConfigProvider } from 'ant-design-vue';
// 这个 import 会带入 a-v 的 reset 与 Planpoint 覆盖层。
// 放在 AdminLayout 而不是 main.js，是为了让参与者端完全不下载 a-v（见 admin-ui.js 注释）
import { ppTheme, ppLocale } from '../../admin-ui.js';
import { adminApi, store } from '../../api.js';
import { toastOk, toastErr } from '../../toast.js';

const route = useRoute();
const router = useRouter();

const meta = reactive({ today: '', dayIndex: 0, totalDays: 0, driver: '', simulated: '' });
const changePwdOpen = ref(false);
const pwdBusy = ref(false);
const pwd = reactive({ oldPassword: '', newPassword: '' });

const nav = computed(() => [
  { to: '/admin/dashboard', label: '总览' },
  { to: '/admin/checkins', label: '打卡明细' },
  { to: '/admin/participants', label: '参与者' },
  { to: '/admin/honors', label: '荣誉名单' },
  { to: '/admin/media', label: '附件与空间', badge: meta.orphans > 0 ? String(meta.orphans) : '' },
  { to: '/admin/tasks', label: '任务字典' },
  { to: '/admin/settings', label: '活动设置' },
]);

const title = computed(() => route.meta.title || '总览');
const subtitle = computed(() => {
  const parts = [];
  if (meta.today) parts.push(`北京日期 ${meta.today}`);
  if (meta.totalDays) parts.push(`活动周期 ${meta.startDate || ''} ~ ${meta.endDate || ''}`);
  return parts.join(' · ') || '数据实时统计';
});

function logout() {
  store.aToken = '';
  router.replace('/admin/login');
}

async function loadMeta() {
  try {
    const me = await adminApi.me();
    meta.today = me.today;
    meta.simulated = me.simulated || '';
    const ov = await adminApi.overview(me.today);
    meta.dayIndex = ov.overview.activity.dayIndex;
    meta.totalDays = ov.overview.activity.totalDays;
    meta.startDate = ov.overview.activity.startDate;
    meta.endDate = ov.overview.activity.endDate;
    meta.driver = ov.storage && ov.storage.driver;
    meta.orphans = ov.overview.pendingMedia;
  } catch (e) { /* 侧栏元信息拿不到不影响主流程 */ }
}

async function submitPwd() {
  if (!pwd.oldPassword || !pwd.newPassword) { toastErr('请填写原密码和新密码'); return; }
  pwdBusy.value = true;
  try {
    const r = await adminApi.changePassword({ oldPassword: pwd.oldPassword, newPassword: pwd.newPassword });
    toastOk(r.message || '密码已更新');
    changePwdOpen.value = false;
    pwd.oldPassword = '';
    pwd.newPassword = '';
    setTimeout(() => { store.aToken = ''; router.replace('/admin/login'); }, 1200);
  } catch (e) {
    toastErr(e.message);
  } finally {
    pwdBusy.value = false;
  }
}

/**
 * a-v 的下拉层（Select 面板、Tooltip、Modal、Message）都挂在 document.body 上，
 * 不在 .pp-antd 里，所以只给外壳加类名的话那些浮层会拿不到 Planpoint 覆盖。
 * 解决办法是把类名加到 body 上，卸载时摘掉 —— 用户跳到家长端就不会串味。
 */
function syncAntdScope(on) {
  document.body.classList.toggle('pp-antd', on);
}

onMounted(() => {
  syncAntdScope(true);
  loadMeta();
});

onBeforeUnmount(() => syncAntdScope(false));
</script>
