<template>
  <div class="pp-antd pp-login">
    <div class="pp-login__card">
      <div class="pp-brand" style="padding: 0 0 8px">
        <span class="pp-brand__mark"></span>
        <div>
          <div class="pp-brand__text">清城少年志</div>
          <div class="pp-brand__sub">打卡统计后台</div>
        </div>
      </div>

      <h1 class="pp-h1" style="margin-top: 20px; font-size: 29px">登录</h1>
      <p class="pp-lead" style="margin-top: 8px">用活动管理员账号登录，查看统计与导出数据。</p>

      <form style="margin-top: 28px; display: flex; flex-direction: column; gap: 16px" @submit.prevent="submit">
        <div class="pp-field">
          <label class="pp-label" for="a-user">账号</label>
          <!-- 用原生 input 挂 ant-input 类：既能拿到 a-v 外观，又能直接 ref 读取真实 DOM 值，
               避免浏览器/密码管家自动填充不触发 input 事件时误判空（这是已知的登录误报成因） -->
          <input id="a-user" ref="userRef" v-model.trim="form.username" class="ant-input" type="text" autocomplete="username" placeholder="admin" />
        </div>
        <div class="pp-field">
          <label class="pp-label" for="a-pwd">密码</label>
          <input id="a-pwd" ref="pwdRef" v-model="form.password" class="ant-input" type="password" autocomplete="current-password" placeholder="••••••••" />
        </div>

        <Button v-if="error" type="text" danger block disabled style="text-align: left; height: auto; padding: 0">
          {{ error }}
        </Button>

        <Button type="primary" html-type="submit" :loading="loading" style="margin-top: 4px">
          {{ loading ? '登录中…' : '登录后台' }}
        </Button>
      </form>

      <p class="pp-caption" style="margin-top: 24px; line-height: 1.7">
        忘记密码请在服务器上重设：
        <code class="pp-mono">node db/init.js --admin-only</code>
      </p>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { Button } from 'ant-design-vue';
import { adminApi, store } from '../../api.js';

const router = useRouter();
const route = useRoute();

const form = reactive({ username: '', password: '' });
const userRef = ref(null);
const pwdRef = ref(null);
const loading = ref(false);
const error = ref('');

async function submit() {
  error.value = '';
  // 兜底：浏览器/密码管家自动填充时可能只改了 DOM 的 value、没触发 input 事件，
  // 导致 v-model 没同步。这里直接读输入框的真实值，避免"看着有字却判空"。
  const username = (form.username || userRef.value?.value || '').trim();
  const password = form.password || pwdRef.value?.value || '';
  if (!username || !password) { error.value = '请填写账号和密码'; return; }

  loading.value = true;
  try {
    const data = await adminApi.login({ username, password });
    store.aToken = data.token;
    const redirect = route.query.redirect;
    router.replace(typeof redirect === 'string' && redirect ? redirect : '/admin/dashboard');
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>
