<template>
  <router-view v-slot="{ Component }">
    <transition name="fade" mode="out-in">
      <component :is="Component" />
    </transition>
  </router-view>

  <!-- 全局提示层：两种皮肤共用，位置在顶部居中，不遮挡底部提交按钮 -->
  <div class="o-toasts">
    <transition-group name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="o-toast"
        :class="{ 'o-toast--ok': t.type === 'ok', 'o-toast--err': t.type === 'err', 'o-toast--warn': t.type === 'warn' }"
        @click="closeToast(t.id)"
      >
        <span>{{ t.message }}</span>
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { toasts, closeToast } from './toast.js';
</script>

<style>
.toast-enter-active, .toast-leave-active { transition: all .22s ease; }
.toast-enter-from { opacity: 0; transform: translateY(-10px); }
.toast-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
