<template>
  <ParticipantShell>
    <section class="o-section" style="flex: 1; text-align: center">
      <div class="o-container o-container--narrow" style="padding-top: 40px">
        <div class="o-eyebrow">404</div>
        <h1 class="o-h2">这个页面找不到了</h1>
        <p class="o-text-muted o-text-sm" style="margin-top: 12px; line-height: 1.7">
          链接可能被截断或者已经失效。回到首页重新进入即可。
        </p>
        <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 28px">
          <router-link to="/" class="o-btn o-btn--primary">回首页</router-link>
          <router-link to="/checkin" class="o-btn o-btn--ghost">去打卡</router-link>
        </div>
      </div>
    </section>
  </ParticipantShell>
</template>

<script setup>
import ParticipantShell from '../components/ParticipantShell.vue';
</script>
