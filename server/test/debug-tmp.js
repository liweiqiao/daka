/** 上传临时文件清理复测：跑一次真实上传，看 .tmp-uploads 有没有残留 */
const fs = require('fs');
const B = process.env.BASE || 'http://127.0.0.1:3000';
const TMP = '.tmp-uploads';

const JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
  + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAA'
  + 'AQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIh'
  + 'MUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpT'
  + 'VFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5'
  + 'usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iii'
  + 'gD//2Q==',
  'base64'
);

(async () => {
  // 先清干净，确保测的是"这一次上传"的行为
  for (const n of fs.readdirSync(TMP)) fs.unlinkSync(`${TMP}/${n}`);
  console.log('上传前临时文件数：', fs.readdirSync(TMP).length);

  const reg = await fetch(`${B}/api/participant/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '字段探测',
      school: '检测小学 一年级4班',
      phone: '196' + String(Date.now()).slice(-8),
    }),
  });
  const token = (await reg.json()).data.token;

  const tk = await fetch(`${B}/api/upload/ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: 'image', mime: 'image/jpeg', size: JPG.length, fileName: 'ok.jpg' }),
  });
  const ticket = (await tk.json()).data;

  const fd = new FormData();
  fd.append('file', new Blob([JPG], { type: 'image/jpeg' }), 'ok.jpg');
  const up = await fetch(`${B}/api/upload/local?key=${encodeURIComponent(ticket.key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  console.log('上传响应：', up.status);

  await new Promise((r) => setTimeout(r, 1200));
  const left = fs.readdirSync(TMP);
  console.log('上传后临时文件数：', left.length, left);
  console.log(left.length === 0 ? '✓ 临时文件即时清掉' : '✗ 仍有残留');
})();
