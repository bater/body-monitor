// Self-contained public landing page served at GET /welcome. It must inline all
// CSS/JS: /welcome is Access-bypassed but the app's hashed asset bundle is not,
// so the page cannot depend on any other file. Keep it dependency-free.

const FEATURES: [string, string, string][] = [
  ["🍱", "AI 飲食記錄", "一句話寫下吃了什麼，自動算出蛋白質與熱量"],
  ["🏋️", "訓練記錄", "重量 × 次數 × 組數，每個動作都有進步曲線"],
  ["📷", "InBody 拍照匯入", "報告拍一張，自動讀取體重、骨骼肌、體脂"],
  ["📈", "趨勢圖表", "蛋白質、體重、肌肉、體脂的變化一目了然"],
  ["🎮", "遊戲化", "XP、等級與 🔥 連勝，把習慣變好玩"],
  ["🤖", "AI 教練", "達標、破紀錄的時刻給你回饋"],
];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

export function renderLanding(): string {
  const featureCards = FEATURES.map(
    ([icon, title, desc]) =>
      `<li><span class="ficon">${icon}</span><div><b>${esc(title)}</b><span>${esc(desc)}</span></div></li>`
  ).join("");

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#F2F4F1" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0F1419" media="(prefers-color-scheme: dark)" />
<title>Body Buddy — 你的隨身健身管家</title>
<style>
:root{--paper:#f2f4f1;--card:#fff;--ink:#1b2733;--ink-2:#5a6673;--ink-3:#8b95a0;--line:#dde1da;--accent:#b3362e;--on-accent:#fff;--good:#2f7a46;--radius:14px;--sans:-apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif}
@media(prefers-color-scheme:dark){:root{--paper:#0f1419;--card:#1a222b;--ink:#e8eae6;--ink-2:#a3adb8;--ink-3:#717c88;--line:#2b3540;--accent:#e06a5e;--on-accent:#141a20;--good:#5cb878}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--sans);background:var(--paper);color:var(--ink);line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:520px;margin:0 auto;padding:32px 20px 48px}
.hero{text-align:center;padding:24px 0 8px}
.logo{font-size:30px;font-weight:800;letter-spacing:-.5px}
.tag{margin-top:10px;font-size:17px;color:var(--ink)}
.sub{margin-top:6px;font-size:13px;color:var(--ink-2)}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px;margin-top:16px}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin-bottom:12px}
ul{list-style:none}
li{display:flex;gap:11px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--line)}
li:first-child{border-top:0}
.ficon{font-size:20px;line-height:1.4}
li b{display:block;font-size:15px}
li span{font-size:13px;color:var(--ink-2)}
form{display:flex;flex-direction:column;gap:10px}
input{width:100%;font-size:16px;font-family:inherit;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{font-family:inherit;font-size:16px;font-weight:700;color:var(--on-accent);background:var(--accent);border:0;border-radius:10px;padding:13px;cursor:pointer}
button:disabled{opacity:.6}
.note{font-size:13px;color:var(--ink-2)}
.ok{color:var(--good);font-weight:600}
.err{color:var(--accent);font-weight:600}
.foot{text-align:center;margin-top:22px;font-size:13px}
.foot a{color:var(--accent);text-decoration:none}
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <div class="logo">Body Buddy</div>
    <div class="tag">你的隨身健身管家</div>
    <div class="sub">吃進多少蛋白質、練了多重、身體組成怎麼變 —— 一個 App 全記下。免安裝・無廣告・資料自有。</div>
  </div>

  <div class="card">
    <div class="eyebrow">功能</div>
    <ul>${featureCards}</ul>
  </div>

  <div class="card">
    <div class="eyebrow">加入等候名單</div>
    <p class="note" style="margin-bottom:12px">Body Buddy 目前為邀請制。留下 Email，通過後我們會寄邀請連結給你。</p>
    <form id="f">
      <input id="email" type="email" required placeholder="你的 Email" autocomplete="email" />
      <input id="note" type="text" maxlength="140" placeholder="想說的話（選填）" />
      <button id="btn" type="submit">加入等候名單</button>
    </form>
    <p class="note" id="msg" style="margin-top:12px"></p>
  </div>

  <div class="foot"><a href="/">已經有帳號了？登入 →</a></div>
</div>
<script>
var f=document.getElementById("f"),btn=document.getElementById("btn"),msg=document.getElementById("msg");
f.addEventListener("submit",function(e){
  e.preventDefault();
  var email=document.getElementById("email").value.trim();
  var note=document.getElementById("note").value.trim();
  if(!email)return;
  btn.disabled=true;msg.className="note";msg.textContent="送出中…";
  fetch("/api/waitlist",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:email,note:note})})
    .then(function(r){return r.json().then(function(b){return{ok:r.ok,b:b}})})
    .then(function(res){
      if(res.ok){msg.className="note ok";msg.textContent=res.b.already?"你已經在等候名單上了，請耐心等候邀請 🙌":"已加入等候名單！通過後會寄邀請到你的信箱 🎉";f.reset();}
      else{msg.className="note err";msg.textContent=res.b.error||"送出失敗，請稍後再試";}
    })
    .catch(function(){msg.className="note err";msg.textContent="送出失敗，請稍後再試";})
    .finally(function(){btn.disabled=false;});
});
</script>
</body>
</html>`;
}
