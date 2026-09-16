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
          <RegisterForm @registered="goNext" />
        </div>

        <!-- 同一个手机号给两个孩子报名是常见情况，明说清楚，免得家长以为系统坏了 -->
        <div class="o-card" style="margin-top: 16px; background: var(--color-paper-mist); box-shadow: none; border: 1px solid var(--color-plum-tinted)">
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
  </ParticipantShell>
</template>

<script setup>
import { useRouter, useRoute } from 'vue-router';
import ParticipantShell from '../components/ParticipantShell.vue';
import RegisterForm from '../components/RegisterForm.vue';

const router = useRouter();
const route = useRoute();

function goNext() {
  const redirect = route.query.redirect;
  router.replace(typeof redirect === 'string' && redirect ? redirect : '/checkin');
}
</script>
