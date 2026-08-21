/* ============================================================================
 * profile-offline.mjs — 量「離線結算到底花多久、時間花在哪」
 *
 * 為什麼要有這支：玩家回報「離線結算跑很久」時，唯一問得出真相的方法是**拿他的存檔實跑**。
 *   新角色重現不出來（空背包、沒傭兵、沒血盟），而「重現不出來」很容易被誤讀成「沒問題」。
 *   2026-07-31 就是靠這支才發現主因是一把武器（吉爾塔斯魔杖，見 apply-core-patches 補丁 9），
 *   在那之前的猜測（裝置慢、背包太大、傭兵太多）全是錯的。
 *
 * 用法：
 *   node scripts/profile-offline.mjs --file <.testdata 檔名> --slot 12 [--hours 1] [--hot]
 *   node scripts/profile-offline.mjs --file <整包備份> --all         ← 掃該備份裡每個存檔位
 *   --hours  模擬離線幾小時（預設 1）。真實上限是 24，但 24 小時的慢角色可能要跑幾十分鐘。
 *   --hot    額外掛上熱點探針（每支函式的次數／累計時間／呼叫者抽樣）——找「為什麼慢」用。
 *            ⚠ 探針本身有成本，總耗時會被墊高；比較快慢請用不帶 --hot 的數字。
 *   --probe  追加要量的函式，逗號分隔；支援 'LZString.compressToUTF16' 這種點路徑。
 *            用法是「順著往下鑽」：先 --hot 看誰貴，再把它內部呼叫的幾支丟進 --probe 再跑一次。
 *   --set    灌檔後覆寫 localStorage，逗號分隔的 k=v。拿來 A/B「某個開關值多少錢」，
 *            例：--set afk_toggle_synccompress=0（實測某玩家存檔 20.0s → 6.5s）。
 *            也可以用它換地圖：--set afk_map_6=dragon_valley（離線結算看的是這個 key，不是存檔裡的位置）。
 *   --player 讀檔後覆寫 player 的欄位，逗號分隔的 k=v（true/false/數字會自動轉型）。
 *            拿來 A/B「某個角色狀態值多少錢」——那些東西存在角色存檔裡，--set 改不到。
 *            例：--player pvpOn=false（實測龍之谷 2.8~4.7s → 1.2s／離線小時）。
 *
 * 讀得懂輸出的重點欄位（其餘見 afk-offline.js 的 buildHistRec）：
 *   settleMs  這次結算實際花掉的真實毫秒 ← 玩家在意的就是這個
 *   perf      分段：kill（擊殺全鏈）/ spawn（出怪）/ clan（血盟讀取）/ save（存檔）
 *   fastEvents/simTicks  快速結算的事件數／逐格真模擬的格數
 *   paceMs    其中有多少只是在等畫面更新（不是在算）
 *
 * ⚠ 修好效能之後「金幣變少、物品變多」是正常的，不是收益變少：自動販賣的「標記後等 N 秒才賣」
 *   看的是真實時鐘，結算跑 90 秒會在結算途中把廢品賣成金幣，跑 1 秒就來不及賣、東西留在背包。
 *   要判斷收益有沒有變，**看擊殺數與掉落，不要看金幣**。
 * ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { listTestSaves, readTestSave, isFullBackup, fullBackupKeys, slotSaveToKeys, injectKeys } from './load-testsave.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

// ── 參數 ──────────────────────────────────────────────────────────────────
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
const FLAG = (name) => process.argv.includes('--' + name);

const FILE = arg('file', listTestSaves()[0]);
const HOURS = Number(arg('hours', 1));
const HOT = FLAG('hot');
const PROBE = (arg('probe', '') || '').split(',').map((x) => x.trim()).filter(Boolean);   // --probe a,b,c 追加要量的函式(預設清單以外的)
const ALL = FLAG('all');
// --set k=v[,k=v] 灌檔後再覆寫幾個 localStorage key,用來 A/B「某個開關對結算耗時的影響」
const SETS = (arg('set', '') || '').split(',').map((x) => x.trim()).filter(Boolean).map((kv) => kv.split('='));
// --player k=v[,k=v] 讀檔後覆寫 player 欄位(存在角色存檔裡、--set 改不到的東西,如 pvpOn)
const PLAYER_SETS = (arg('player', '') || '').split(',').map((x) => x.trim()).filter(Boolean).map((kv) => kv.split('='));
if (!FILE) { console.error('❌ .testdata/ 沒有存檔——請先放一份進去（該資料夾已 gitignore）'); process.exit(1); }

const raw = readTestSave(FILE);
const full = isFullBackup(raw);
let slots;
if (ALL) {
  if (!full) { console.error('❌ --all 只能用在整包備份（單存檔位的檔只有一格）'); process.exit(1); }
  slots = Object.keys(JSON.parse(raw).keys)
    .map((k) => /^lineage_idle_save_(\d+)$/.exec(k)).filter(Boolean)
    .map((m) => Number(m[1])).sort((a, b) => a - b);
} else {
  slots = [Number(arg('slot', 1))];
}
console.log(`存檔：${FILE}（${full ? '整包 localStorage 備份' : '單存檔位'}）·離線 ${HOURS} 小時·存檔位 ${slots.join(', ')}${HOT ? '·熱點探針開' : ''}`);

// ── 靜態伺服器（同 smoke-hooks：不能直接開 file://，Worker / fetch 都要 http）──
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const buf = await readFile(join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, '')));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('not found'); }
});
// 固定 port 會在「上一輪被中斷、行程還沒收掉」時撞 EADDRINUSE(踩過);讓 OS 給一個沒人用的
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

// ── 頁面內：熱點探針（--hot 才裝）────────────────────────────────────────
//   包住幾支「每殺一隻怪都會經過」的函式，記次數／累計時間／呼叫者。
//   呼叫者是抽樣記的（每 N 次抓一次 stack）——每次都抓的話光組 stack 就會蓋過被量的東西。
function installProbes(extra) {
  const P = window.__PROF = { fn: {}, callers: {} };
  const NAMES = ['killMob', 'spawnMob', 'settleDeadMobs', 'gainItem', 'recomputeStats', 'calcStats',
    'getClanBuffStats', '_clanReadState', '_clanNormalizeState', 'saveGame', 'autoSortInventory',
    'pvpOnKillMob', 'npcClanMaybeStartGroupBattle', 'alliesTick', 'updateUI'].concat(extra || []);
  for (const name of NAMES) {
    // 支援 'LZString.compressToUTF16' 這種點路徑——熱點常常不是全域函式而是某個物件的方法
    const path = name.split('.');
    const owner = path.length > 1 ? path.slice(0, -1).reduce((o, k) => (o ? o[k] : null), window) : window;
    const key = path[path.length - 1];
    const f = owner && owner[key];
    if (typeof f !== 'function') continue;
    P.fn[name] = { n: 0, ms: 0 };
    owner[key] = function () {
      const s = P.fn[name];
      s.n++;
      if (s.n % 25 === 1) {
        try {
          const st = (new Error()).stack.split('\n').slice(2, 5)
            .map((l) => l.trim().replace(/^at\s+/, '').replace(/\s*\(.*$/, '')).join(' ← ');
          P.callers[name + ' :: ' + st] = (P.callers[name + ' :: ' + st] || 0) + 1;
        } catch (e) { /* 拿不到 stack 就只記次數 */ }
      }
      const t = performance.now();
      try { return f.apply(this, arguments); } finally { s.ms += performance.now() - t; }
    };
  }
  const jp = JSON.parse;
  P.json = { n: 0, ms: 0, chars: 0 };
  JSON.parse = function (s) {
    P.json.n++; P.json.chars += (typeof s === 'string' ? s.length : 0);
    const t = performance.now();
    try { return jp.apply(this, arguments); } finally { P.json.ms += performance.now() - t; }
  };
}

// ── 主流程：一格一個全新分頁（重複用同一頁會讓計時器/監聽疊加，數字全污染）──
const browser = await chromium.launch();
const results = [];

// 單存檔位的檔要先借一個載入好遊戲的分頁,用遊戲自己的 _saveWrap 包成 localStorage 格式
let slotKeys = null;
if (!full) {
  const prep = await browser.newContext();
  const pp = await prep.newPage();
  await pp.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await pp.waitForFunction(() => typeof window._saveWrap === 'function', null, { timeout: 30000 });
  slotKeys = await slotSaveToKeys(pp, { raw, slot: slots[0] });
  await prep.close();
}

// 上次關閉時人在村莊 → afk-offline 本來就直接略過(見它的 maybeCatchup)，跑下去只是白等
const keysOf = (slot) => (full ? fullBackupKeys(raw) : slotKeys);
for (const slot of slots) {
  const savedMap = keysOf(slot)['afk_map_' + slot];
  if (!savedMap || savedMap.indexOf('town_') === 0) {
    console.log(`\n───── 存檔位 ${slot}：關閉時在${savedMap ? '村莊(' + savedMap + ')' : '無地圖'}，離線本來就不結算，略過`);
    continue;
  }

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));

  // 先在同 origin 的空白頁灌存檔，再導到 index.html——否則遊戲會先用空 localStorage 跑起來
  await page.goto(`http://127.0.0.1:${PORT}/scripts/afk-plugin-block.html`, { waitUntil: 'domcontentloaded' });
  await injectKeys(page, { keys: full ? fullBackupKeys(raw) : slotKeys, slot, offlineHours: HOURS });
  if (SETS.length) await page.evaluate((sets) => sets.forEach(([k, v]) => localStorage.setItem(k, v)), SETS);

  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  const bootDl = Date.now() + 30000;
  while (Date.now() < bootDl && !logs.some((l) => l.startsWith('[AFK] hooks OK'))) await page.waitForTimeout(200);
  if (!logs.some((l) => l.startsWith('[AFK] hooks OK'))) { console.error(`❌ 存檔位 ${slot}：afk-offline 沒掛上，跳過`); await ctx.close(); continue; }

  if (HOT) await page.evaluate(installProbes, PROBE);
  // --player：包住 loadGame，讀完檔立刻覆寫欄位。必須在這裡包(結算是 loadGame 之後才非同步排程的)，
  //   等 loadGame 回來再改就可能已經有事件跑過去了。
  if (PLAYER_SETS.length) await page.evaluate((sets) => {
    const cast = (v) => (v === 'true' ? true : v === 'false' ? false : (v !== '' && !isNaN(Number(v)) ? Number(v) : v));
    const orig = window.loadGame;
    window.loadGame = function () {
      const r = orig.apply(this, arguments);
      try { sets.forEach(([k, v]) => { player[k] = cast(v); }); } catch (e) {}
      return r;
    };
  }, PLAYER_SETS);
  const t0 = Date.now();
  const who = await page.evaluate((slot) => {
    window.__afk.last = null;          // 結算跑完會被設起來 → 拿它當「真的跑完了」的訊號
    currentSlot = slot;
    loadGame();
    return { cls: player.cls, lv: player.lv, allies: (player.allies || []).length, inv: (player.inv || []).length };
  }, slot);

  // 等結算收尾。⚠ 不能改看「離線紀錄有沒有出現」——檢查點中途就會先寫一筆，會早退拿到半套數字
  //   另一種永遠等不到的情況：afk-offline 決定「這格不該結算」(攻城區／受僱傭兵／非標準戰場)，
  //   那時它只印一行 [AFK] 就 return，__afk.last 永遠是 null → 認那行 console 才不會空等到逾時。
  const SKIP_RE = /略過離線結算|無離線戰鬥收益|不自行掛機|離線略過/;
  const dl = Date.now() + 40 * 60 * 1000;
  let done = false, skipped = '';
  while (Date.now() < dl) {
    done = await page.evaluate(() => !!(window.__afk && window.__afk.last));
    if (done) break;
    const hit = logs.find((l) => SKIP_RE.test(l));
    if (hit) { skipped = hit; break; }
    await page.waitForTimeout(500);
  }
  if (skipped) {
    console.log(`\n───── 存檔位 ${slot}：afk-offline 判定不結算 → ${skipped.replace(/^\[AFK\]\s*/, '')}`);
    await ctx.close();
    continue;
  }
  const wallMs = Date.now() - t0;

  const out = await page.evaluate((slot) => {
    let rec = null;
    try { rec = JSON.parse(localStorage.getItem('afk_hist_' + slot))[0]; } catch (e) { /* 沒紀錄就只回 null */ }
    const P = window.__PROF;
    return {
      rec, prof: P && {
        fn: Object.entries(P.fn).filter(([, v]) => v.n).map(([k, v]) => [k, v.n, Math.round(v.ms)]).sort((a, b) => b[2] - a[2]),
        callers: Object.entries(P.callers).sort((a, b) => b[1] - a[1]).slice(0, 12),
        json: { n: P.json.n, ms: Math.round(P.json.ms), MB: Math.round(P.json.chars / 1048576) },
      },
      wandHolders: (function () {
        // 拿杖的人＝逐殺重算的來源（補丁 9 修掉的那個熱點）；沒修的版本上，這裡有人就會慢
        const has = (x) => !!(x && x.eq && x.eq.wpn && x.eq.wpn.id === 'wpn_giltas_wand');
        const out = [];
        if (has(player)) out.push('主角');
        (player.allies || []).forEach((a, i) => { if (has(a)) out.push('傭兵' + i + '(' + (a._allyName || a.cls) + ')'); });
        return out;
      })(),
      lzcache: (window.AFK_LZCACHE && window.AFK_LZCACHE.stats()) || null,
      roster: (window.AFK_CLANROSTER && window.AFK_CLANROSTER.counts()) || null,   // 血盟名冊筆數(結算後)——野外 PVP 開著時,它就是每次寫入的成本來源
    };
  }, slot);
  await ctx.close();

  const r = out.rec;
  console.log(`\n───── 存檔位 ${slot}：${who.cls} Lv.${who.lv}・傭兵 ${who.allies}・背包 ${who.inv}${done ? '' : '（⚠ 逾時，數字不完整）'}`);
  if (out.wandHolders.length) console.log(`  🪄 吉爾塔斯魔杖持有者：${out.wandHolders.join('、')}`);
  if (r) {
    console.log(`  結算耗時 ${(r.settleMs / 1000).toFixed(1)}s（結算了 ${(r.settledMs / 3600000).toFixed(2)} 小時的離線）`
      + `　→ 每離線小時 ${(r.settleMs / (r.settledMs / 3600000) / 1000).toFixed(1)}s`);
    console.log('  ' + JSON.stringify({
      fastEvents: r.fastEvents, simTicks: r.simTicks, fastWhy: r.fastWhy, paceMs: r.paceMs,
      sliceN: r.sliceN, sliceMax: r.sliceMax, ckptN: r.ckptN, ckptMs: r.ckptMs,
      invMax: r.invMax, allies: r.allies, petsOut: r.petsOut, pvpOn: r.pvpOn, died: r.died, perf: r.perf,
    }));
    const kills = (r.kills || []).reduce((a, b) => a + (b.cnt || 0), 0);
    const items = (r.items || []).reduce((a, b) => a + (b.cnt || 0), 0);
    console.log(`  收益對照（改效能前後要比這兩個，不是比金幣）：擊殺 ${kills}、獲得物品 ${items}、金幣 ${r.gold}`);
    results.push({ slot, settleMs: r.settleMs, perHourS: r.settleMs / (r.settledMs / 3600000) / 1000, wand: out.wandHolders.length, kills });
  } else {
    console.log('  ⚠ 沒拿到離線紀錄（沒觸發結算？地圖是村莊、或角色已死）');
  }
  if (out.lzcache) console.log('  快取：' + JSON.stringify(out.lzcache));
  if (out.roster) console.log('  血盟名冊(結算後)：' + JSON.stringify(out.roster));
  if (out.prof) {
    console.log(`  JSON.parse：${out.prof.json.n} 次 / ${out.prof.json.ms}ms / ${out.prof.json.MB}MB`);
    console.log('  熱點 [函式, 次數, 累計ms(含子呼叫)]：');
    out.prof.fn.forEach((x) => console.log('    ' + JSON.stringify(x)));
    console.log('  呼叫者（每 25 次抽 1）：');
    out.prof.callers.forEach(([k, v]) => console.log(`    ${v}  ${k}`));
  }
  console.log(`  （牆鐘 ${(wallMs / 1000).toFixed(1)}s，含載入與輪詢）`);
  if (errs.length) console.log('  ⚠ JS 錯誤：' + errs.slice(0, 3).join(' | '));
}

if (results.length > 1) {
  console.log('\n===== 總表（每離線小時要花幾秒結算）=====');
  results.sort((a, b) => b.perHourS - a.perHourS)
    .forEach((x) => console.log(`  存檔位 ${String(x.slot).padStart(2)}　${x.perHourS.toFixed(1)}s/離線小時　${x.wand ? '🪄×' + x.wand : ''}`));
}

await browser.close();
server.close();
