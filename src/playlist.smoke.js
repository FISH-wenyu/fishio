// Smoke test for /api/taste/playlist using native fetch (UTF-8 safe, unlike
// PowerShell 5.1 which mangles Chinese characters in Invoke-RestMethod).
// Run: node src/playlist.smoke.js
const URL = "http://localhost:8080/api/taste/playlist";

const text = `稻香 - 周杰伦
不能说的秘密 - 周杰伦
富士山下 - 陈奕迅
# 这行被忽略
你的背包 - 陈奕迅
灰色头像 - 许嵩`;

const r = await fetch(URL, {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ bucket: "favorites", text }),
});
console.log("status", r.status);
console.log(await r.json());
