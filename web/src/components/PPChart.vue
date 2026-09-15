<template>
  <div class="ppchart">
    <!-- 加载态：用和卡片同色系的骨架块，不要出现"白洞" -->
    <div v-if="loading" class="pp-skel ppchart__skel" :style="{ height: height + 'px' }"></div>

    <!-- 空态：后端没数据时也要给一句人话，而不是一个空白框 -->
    <div v-else-if="empty" class="ppchart__empty" :style="{ height: height + 'px' }">
      {{ emptyText }}
    </div>

    <div v-else ref="host" class="ppchart__host" :style="{ height: height + 'px' }"></div>
  </div>
</template>

<script setup>
/**
 * PPChart —— 所有后台图表都套这一层，不要在页面里直接 echarts.init。
 *
 * 它替页面处理掉三件麻烦事：
 *   1. 自适应：ResizeObserver 监听容器，侧栏折叠／窗口缩放都能跟上
 *   2. 生命周期：卸载时 dispose，不然切换路由会留下几十个僵尸实例
 *   3. 空态与加载态：页面只管传 option，不用自己写 v-if
 *
 * 注意 notMerge: true —— 我们的 option 都是**完整对象**，
 * 合并式更新会在"从有系列切到空图"时把老系列留在画布上。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { initChart } from '../charts/echarts.js';

const props = defineProps({
  option: { type: Object, default: () => ({}) },
  height: { type: Number, default: 280 },
  loading: { type: Boolean, default: false },
  /** 由页面判断"这个口径到底有没有数据"，比在 option 里猜更准 */
  empty: { type: Boolean, default: false },
  emptyText: { type: String, default: '暂无数据' },
});

const host = ref(null);
// 用 shallowRef：把整个 ECharts 实例变成深层响应式会拖垮性能，也会让内部状态错乱
const chart = shallowRef(null);
let ro = null;

function render() {
  if (!chart.value || props.loading || props.empty) return;
  // notMerge: true —— 见文件头注释
  chart.value.setOption(props.option || {}, { notMerge: true });
}

async function mountChart() {
  await nextTick();
  if (!host.value || chart.value) return;
  // ECharts 在 0×0 的容器上初始化会打印警告且画不出东西，
  // 挂在 v-if 里的图表切回来时就会遇到，所以先量一下
  if (!host.value.clientWidth) return;
  chart.value = initChart(host.value);
  render();
  bindResize();
}

function bindResize() {
  if (typeof ResizeObserver === 'undefined' || !host.value) return;
  ro = new ResizeObserver(() => {
    // 容器宽度为 0 时（被折叠／被隐藏）resize 会抛错，直接跳过
    if (host.value && host.value.clientWidth && chart.value) chart.value.resize();
  });
  ro.observe(host.value);
}

function teardown() {
  if (ro) { ro.disconnect(); ro = null; }
  if (chart.value) { chart.value.dispose(); chart.value = null; }
}

// option 变了重画；loading/empty 从 true 变 false 时要在这时候才建实例
watch(() => props.option, render, { deep: true });
watch([() => props.loading, () => props.empty], async ([l, e]) => {
  if (l || e) { teardown(); return; }
  if (!chart.value) await mountChart();
  else render();
});

onMounted(mountChart);
onBeforeUnmount(teardown);

defineExpose({ chart });
</script>

<style scoped>
.ppchart { width: 100%; }
.ppchart__host { width: 100%; }
.ppchart__skel { border-radius: 18px; }
.ppchart__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--pp-slate, #333);
  font-size: 13px;
  background: var(--pp-mist, #f0f2f4);
  border-radius: 18px;
}
</style>
