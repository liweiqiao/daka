<template>
  <ParticipantShell>
    <section class="o-section" style="flex: 1">
      <div class="o-container o-container--narrow">
        <div class="o-eyebrow">STEP 1 / 3</div>
        <h1 class="o-h2">先登记一次，之后每天不用再填</h1>
        <p class="o-text-muted o-text-sm" style="margin-top: 10px; line-height: 1.7">
          这三项只在第一次打卡时填。之后在微信里打开同一个链接，就直接进入打卡页。
        </p>

        <div class="o-card o-card--pad-lg" style="margin-top: 28px">
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
              {{ submitting ? '正在登记…' : '提交登记' }}
            </button>
          </form>
        </div>

        <!-- 同一个手机号给两个孩子报名是常见情况，明说清楚，免得家长以为系统坏了 -->
        <div class="o-card" style="margin-top: 16px; background: #faf7fa; box-shadow: none; border: 1px solid var(--color-plum-tinted)">
          <div class="o-label">家里有两个孩子？</div>
          <p class="o-text-sm o-text-muted" style="line-height: 1.8; margin-top: 6px">
            可以共用同一个手机号，只要姓名不同，系统会当成两个独立的孩子分别统计，互不影响。
            重名也不会混淆。
          </p>
        </div>

        <p class="o-text-caption o-text-muted" style="margin-top: 20px; text-align: center">
          已经登记过了？
          <router-link to="/checkin" style="color: var(--color-heather); text-decoration: underline">直接去打卡</router-link>
        </p>
      </div>
    </section>

    <!-- 重名提醒：登记成功后如果发现同名的人，让家长自检手机号有没有填错 -->
    <Modal :open="showSameName" title="发现有同名的孩子" @close="goNext">
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
        <button class="o-btn o-btn--primary" @click="goNext">确认无误，去打卡</button>
      </template>
    </Modal>
  </ParticipantShell>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import ParticipantShell from '../components/ParticipantShell.vue';
import Modal from '../components/Modal.vue';
import { api, store } from '../api.js';
import { loadMe, loadActivity, setParticipant, state } from '../appstate.js';
import { toastOk, toastErr } from '../toast.js';

const router = useRouter();
const route = useRoute();

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
      await goNext();
    }
  } catch (e) {
    toastErr(e.message);
    if (e.detail && e.detail.field) errors[e.detail.field] = e.message;
  } finally {
    submitting.value = false;
  }
}

async function goNext() {
  showSameName.value = false;
  await Promise.all([loadActivity(), loadMe(true)]);
  const redirect = route.query.redirect;
  router.replace(typeof redirect === 'string' && redirect ? redirect : '/checkin');
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
