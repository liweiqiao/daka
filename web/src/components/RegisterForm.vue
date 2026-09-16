<template>
  <div class="o-register-form">
    <form @submit.prevent="submit">
      <div class="o-field">
        <label class="o-label" for="f-name">学生姓名<span class="o-label__req">*</span></label>
        <input
          id="f-name"
          v-model.trim="form.name"
          class="o-input"
          :class="{ 'is-error': errors.name }"
          type="text"
          maxlength="16"
          placeholder="请填孩子真实姓名"
          autocomplete="name"
        />
        <p v-if="errors.name" class="fld-err">{{ errors.name }}</p>
      </div>

      <div class="o-field">
        <label class="o-label" for="f-school">学校与班级<span class="o-label__req">*</span></label>
        <input
          id="f-school"
          v-model.trim="form.school"
          class="o-input"
          :class="{ 'is-error': errors.school }"
          type="text"
          maxlength="60"
          placeholder="例如：清城区第一小学 三年级2班"
        />
        <p class="o-hint">证书上会写学校名，请写全称。</p>
        <p v-if="errors.school" class="fld-err">{{ errors.school }}</p>
      </div>

      <div class="o-field">
        <label class="o-label" for="f-phone">联系方式<span class="o-label__req">*</span></label>
        <input
          id="f-phone"
          v-model.trim="form.phone"
          class="o-input"
          :class="{ 'is-error': errors.phone }"
          type="tel"
          inputmode="numeric"
          maxlength="11"
          placeholder="11 位手机号"
          autocomplete="tel"
        />
        <p class="o-hint">这是后期证书发放和活动通知的唯一凭证，请确认能收到短信。</p>
        <p v-if="errors.phone" class="fld-err">{{ errors.phone }}</p>
      </div>

      <button class="o-btn o-btn--primary o-btn--block o-btn--lg" type="submit" :disabled="submitting">
        <span v-if="submitting" class="o-loading"></span>
        {{ submitting ? '正在提交…' : submitText }}
      </button>
    </form>

    <!-- 重名提醒：提交成功后如果发现同名的人，让家长自检手机号有没有填错 -->
    <Modal :open="showSameName" title="发现有同名的孩子" @close="finish">
      <p class="o-text-sm" style="line-height: 1.8">
        系统里有 {{ sameName.count }} 位同样叫「{{ sameName.name }}」的孩子
        <span v-if="sameName.schools && sameName.schools.length">
          ，分别来自：{{ sameName.schools.join('、') }}
        </span>。
      </p>
      <p class="o-text-sm o-text-muted" style="line-height: 1.8; margin-top: 12px">
        如果你的孩子不在里面，说明手机号和之前登记的不一样，系统已经另建了一条新记录，不会互相干扰。
        这不是错误，确认无误继续即可。
      </p>
      <template #footer>
        <button class="o-btn o-btn--primary" @click="finish">确认无误，继续打卡</button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
/**
 * RegisterForm.vue —— 信息登记表单（登记页与打卡页共用）。
 *
 * 为什么要抽出来：活动改成"打开链接直接进打卡页"，没填过信息的孩子
 * 就在打卡页顶部填这三项，填完原地继续打卡，不用再跳一个页面。
 * 于是同一个表单有了两个入口，逻辑（校验、重名提醒、token 落地）必须只有一份，
 * 否则以后改校验规则一定会漏掉其中一个。
 *
 * 提交成功后 emit('registered')，由所在页面决定下一步去哪。
 */
import { reactive, ref } from 'vue';
import Modal from './Modal.vue';
import { api, store } from '../api.js';
import { loadMe, loadActivity } from '../appstate.js';
import { toastOk, toastErr } from '../toast.js';

const props = defineProps({
  // 按钮文案：登记页是"提交登记"，打卡页是"填好了，去打卡"
  submitText: { type: String, default: '提交登记' },
});
void props;
const emit = defineEmits(['registered']);

const form = reactive({ name: '', school: '', phone: '' });
const errors = reactive({ name: '', school: '', phone: '' });
const submitting = ref(false);
const showSameName = ref(false);
const sameName = reactive({ count: 0, name: '', schools: [] });

function validate() {
  errors.name = '';
  errors.school = '';
  errors.phone = '';

  const n = form.name.replace(/\s+/g, '');
  if (!n) errors.name = '请填写学生姓名';
  else if (n.length < 2) errors.name = '姓名至少 2 个字';
  else if (!/^[\u4e00-\u9fa5a-zA-Z·．.]+$/.test(n)) errors.name = '姓名只能填中文或字母';

  if (!form.school) errors.school = '请填写学校和班级';
  else if (form.school.length < 2) errors.school = '学校名太短了，请写全称';

  const p = form.phone.replace(/\D/g, '');
  if (!p) errors.phone = '请填写手机号';
  else if (!/^1[3-9]\d{9}$/.test(p)) errors.phone = '请填写正确的 11 位手机号';

  return !errors.name && !errors.school && !errors.phone;
}

async function submit() {
  if (submitting.value) return;
  if (!validate()) return;

  submitting.value = true;
  try {
    const data = await api.register({
      name: form.name,
      school: form.school,
      phone: form.phone.replace(/\D/g, ''),
    });
    store.pToken = data.token;
    toastOk(data.message || '登记完成');

    const hasDup = data.sameName && data.sameName.count > 0;
    if (hasDup) {
      sameName.count = data.sameName.count;
      sameName.name = form.name;
      sameName.schools = data.sameName.schools || [];
      showSameName.value = true;
    } else {
      await finish();
    }
  } catch (e) {
    toastErr(e.message);
    if (e.detail && e.detail.field) errors[e.detail.field] = e.message;
  } finally {
    submitting.value = false;
  }
}

/** 登记完成：先把活动信息与"我"的状态刷成最新的，再交给页面决定去哪 */
async function finish() {
  showSameName.value = false;
  await Promise.all([loadActivity(true), loadMe(true)]);
  emit('registered');
}
</script>

<style scoped>
.fld-err {
  font-size: var(--text-caption);
  color: var(--color-strawberry);
  margin-top: 6px;
  line-height: 1.5;
}
</style>
