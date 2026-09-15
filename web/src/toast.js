/**
 * toast.js —— 极简全局提示。
 * 微信里 alert() 会阻塞且样式丑，统一用它替代。
 */

import { reactive } from 'vue';

export const toasts = reactive([]);

let seq = 0;

export function toast(message, type = 'info', ms = 2600) {
  if (!message) return;
  const id = ++seq;
  toasts.push({ id, message: String(message), type });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, ms);
  return id;
}

export const toastOk = (m) => toast(m, 'ok');
export const toastErr = (m) => toast(m, 'err', 3600);
export const toastWarn = (m) => toast(m, 'warn', 3200);

export function closeToast(id) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}
