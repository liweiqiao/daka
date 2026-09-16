import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * 开发时用 vite 自带代理把 /api 和 /media 转到 Koa（:3000），
 * 这样浏览器里是同源请求，不会踩跨域和 Cookie 的坑。
 * 打包后 dist 交给 Koa 托管，同样是同源，配置零改动。
 *
 * 分离部署（GitHub Pages 等）通过环境变量注入，两种模式互不影响：
 *   VITE_BASE_PATH=/daka/                            —— 站点挂到子路径（Pages 的仓库名）
 *   VITE_API_BASE=http://120.79.240.81:3010          —— 接口打向后端（配合 web/src/api.js）
 */
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/media': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        /**
         * 手工分包，三条原则：
         *   1. vendor 是参与者端与后台共用的，单独一个 chunk，别让家长重复下载
         *   2. echarts / ant-design-vue 只有后台路由会 import。分包之后它们只挂在
         *      被懒加载的后台页下面 —— 家长打开 H5 时一个字节都拿不到
         *   3. 这里写包名不等于把整个包塞进来：manualChunks 只对"已在依赖图里"
         *      的模块生效，a-v 里没被 import 的组件照样会被摇掉
         */
        manualChunks: {
          vendor: ['vue', 'vue-router'],
          echarts: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'],
          antd: ['ant-design-vue'],
        },
      },
    },
  },
}));
