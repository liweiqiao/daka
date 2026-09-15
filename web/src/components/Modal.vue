<template>
  <div v-if="open" class="o-mask" @click.self="onMask">
    <div class="o-modal" :class="{ 'o-modal--wide': wide }">
      <div class="row">
        <h3 class="o-h3" style="flex: 1">{{ title }}</h3>
        <button class="xbtn no-select" aria-label="关闭" @click="close">×</button>
      </div>
      <div style="margin-top: 16px">
        <slot />
      </div>
      <div v-if="$slots.footer" style="margin-top: 24px; display: flex; gap: 12px; justify-content: flex-end; flex-wrap: wrap">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  wide: { type: Boolean, default: false },
  maskClose: { type: Boolean, default: true },
});
const emit = defineEmits(['close']);

function close() { emit('close'); }
function onMask() { if (props.maskClose) close(); }
</script>

<style scoped>
.row { display: flex; align-items: flex-start; gap: 12px; }
.xbtn {
  font-size: 26px;
  line-height: 1;
  color: var(--color-heather);
  padding: 0 4px;
  flex-shrink: 0;
}
.xbtn:hover { color: var(--color-aubergine); }
</style>
