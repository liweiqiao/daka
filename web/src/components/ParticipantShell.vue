<template>
  <div class="o-page">
    <!-- 演练模式横幅：只在服务端开了"模拟日期"时出现，正式活动期间不会渲染 -->
    <div v-if="simulated" class="o-simbar">
      演练模式 · 系统当前把 {{ simulated }} 当作「今天」，此页数据仅用于内部测试
    </div>

    <nav class="o-nav">
      <div class="o-container o-nav__inner">
        <router-link to="/" class="o-nav__logo no-select">
          <span class="o-mark" aria-hidden="true"></span>
          <span>清城少年志</span>
        </router-link>

        <div class="o-nav__links">
          <router-link to="/checkin" class="o-nav__link" active-class="is-active">今日打卡</router-link>
          <router-link to="/records" class="o-nav__link" active-class="is-active">我的记录</router-link>
          <router-link v-if="!hideBoard" to="/board" class="o-nav__link" active-class="is-active">打卡战报</router-link>
        </div>
      </div>
    </nav>

    <slot />

    <footer class="o-footer">
      <div class="o-container">
        <div>{{ activityTitle }}</div>
        <div style="margin-top: 4px">
          清远市清城区校外未成年人心理健康辅导站 · 满天星心理志愿服务队
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { state } from '../appstate.js';

defineProps({ hideBoard: { type: Boolean, default: false } });

const activityTitle = computed(() => (state.activity && state.activity.title) || '清城少年志 · 国庆七天打卡');
const simulated = computed(() => state.simulated || '');
</script>

<style scoped>
.o-simbar {
  position: sticky;
  top: 0;
  z-index: 60;
  padding: 7px 12px;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.5;
  text-align: center;
  color: #7a3d00;
  background: repeating-linear-gradient(135deg, #fff3d6 0 12px, #ffe9b8 12px 24px);
  border-bottom: 1px solid #f0cf88;
}
</style>
