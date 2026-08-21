/* ============================================================================
 * fetch-transfer-code.mjs — 用玩家給的「六碼轉移碼」把他的整包存檔抓下來
 *
 * 為什麼要有這支:玩家回報問題時,最有效的做法是拿他的存檔實跑(見 scripts/profile-offline.mjs
 *   的檔頭)。afk-fullsave 的轉移碼就是玩家最容易給的形式——他在遊戲裡按「產生轉移碼」念六碼給你,
 *   這支直接抓成 .testdata/ 裡的檔,接著就能丟給 profile-offline / 各種重現腳本。
 *
 * 用法:
 *   node scripts/fetch-transfer-code.mjs ywfxxy
 *   node scripts/fetch-transfer-code.mjs https://litter.catbox.moe/ywfxxy.json   ← 整串網址也吃
 *   node scripts/fetch-transfer-code.mjs ywfxxy --out _user_dragonvalley.json    ← 自己指定檔名
 *
 * 存到 `.testdata/_code_<六碼>.json`(底線開頭＝listTestSaves 會跳過,要指名才用;見 .testdata/_README.md)。
 * 存下來的就是 afk-fullsave 的「整包備份」格式,profile-offline.mjs 的 --all 直接吃。
 *
 * ⚠️ 轉移碼是 Litterbox 的暫存檔,**24 小時後自動刪除**;抓不到多半是過期或碼看錯
 *   (0/o、1/l 很容易看錯——絕不可自作聰明換成別的字元再試一次,那可能抓到別人的存檔)。
 * ⚠️ 只驗 afk-fullsave 自己寫進去的欄位(format/schema/keyCount),**不看 keys 裡面裝什麼**——
 *   認得內容就是對上游存檔格式做假設,作者改個名字就會把合法備份擋在門外(afk-fullsave.js 檔頭同理)。
 * ========================================================================== */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTDIR = join(ROOT, '.testdata');
const FILE_BASE = 'https://litter.catbox.moe/';
const FORMAT = 'idle-lineage-full';
const CODE_RE = /^[a-z0-9]{6}$/;

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
};

// 玩家可能念成大寫、貼整串網址、多帶 .json —— 全部收斂成六碼(但不替換任何字元)
function normalizeCode(s) {
  let t = String(s || '').trim().toLowerCase();
  if (t.includes('/')) t = t.slice(t.lastIndexOf('/') + 1);
  return t.replace(/\.json$/, '').trim();
}

const code = normalizeCode(process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) || '');
if (!CODE_RE.test(code)) {
  console.error('用法: node scripts/fetch-transfer-code.mjs <六碼轉移碼|網址> [--out 檔名]');
  console.error(code ? `❌ 「${code}」不是六碼英數轉移碼。` : '');
  process.exit(1);
}

const url = FILE_BASE + code + '.json';
console.log('抓取', url);
let res;
try { res = await fetch(url, { cache: 'no-store' }); }
catch (e) { console.error('❌ 連不上 Litterbox:', e.message); process.exit(1); }
if (res.status === 404) {
  console.error('❌ 找不到這組轉移碼。可能是超過 24 小時自動刪除了,或六碼看錯(0/o、1/l)。');
  console.error('   → 請玩家在遊戲裡重新按一次「產生轉移碼」,不要自己猜別的字元。');
  process.exit(1);
}
if (!res.ok) { console.error(`❌ 讀取失敗(HTTP ${res.status})`); process.exit(1); }
const text = await res.text();

let pack;
try { pack = JSON.parse(text); } catch (e) { pack = null; }
if (!pack || typeof pack !== 'object' || pack.format !== FORMAT) {
  console.error(`❌ 抓到的東西不是備份檔(format=${pack && pack.format})。`); process.exit(1);
}
const keys = pack.keys && typeof pack.keys === 'object' && !Array.isArray(pack.keys) ? pack.keys : null;
const names = keys ? Object.keys(keys) : [];
if (!names.length || (pack.keyCount != null && pack.keyCount !== names.length)) {
  console.error(`❌ 備份檔不完整(keyCount=${pack.keyCount}、實際 ${names.length} 筆)。`); process.exit(1);
}

if (!existsSync(OUTDIR)) mkdirSync(OUTDIR, { recursive: true });
const outName = arg('out', `_code_${code}.json`);
const outPath = join(OUTDIR, outName);
writeFileSync(outPath, text);

// ── 摘要:直接看得出「哪一格在哪張圖、離線多久」,省得再開一支腳本查 ──────────
const size = (s) => (String(s).length / 1024 >= 1024
  ? (String(s).length / 1048576).toFixed(2) + ' MB'
  : (String(s).length / 1024).toFixed(1) + ' KB');
const slots = names.map((k) => /^lineage_idle_save_(\d+)$/.exec(k)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);
const nowMs = Date.now();

console.log(`\n✅ 已存成 .testdata/${outName}(schema ${pack.schema}、${names.length} 個 key、共 ${size(text)})`);
console.log(`\n存檔位 ${slots.length} 格:`);
for (const n of slots) {
  const map = keys['afk_map_' + n];
  const ts = Number(keys['afk_ts_' + n]);
  const off = Number.isFinite(ts) && ts > 0 ? ((nowMs - ts) / 3600000).toFixed(1) + ' 小時前' : '—';
  console.log(`  slot ${String(n).padStart(2)}  ${size(keys['lineage_idle_save_' + n]).padStart(9)}  地圖=${map || '—'}  最後離線=${off}`);
}
const other = names.filter((k) => !/^(lineage_idle_save_|afk_map_|afk_ts_)\d+$/.test(k));
console.log(`\n其他 key ${other.length} 個(倉庫/血盟/收集冊/開關…),最大的幾個:`);
other.map((k) => [k, String(keys[k]).length]).sort((a, b) => b[1] - a[1]).slice(0, 6)
  .forEach(([k, len]) => console.log(`  ${size(keys[k]).padStart(9)}  ${k}`));

console.log(`\n接著可以跑:`);
console.log(`  node scripts/profile-offline.mjs --file ${outName} --all          ← 掃每一格的離線結算耗時`);
console.log(`  node scripts/profile-offline.mjs --file ${outName} --slot <N> --hot   ← 單格找熱點`);
console.log(`\n(這份是玩家真實資料,.testdata/ 已 gitignore;用完請自行決定要不要留,並在 .testdata/_README.md 補一行說明用途)`);
