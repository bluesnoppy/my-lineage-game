/**
 * sync-upstream.mjs — 從上游 clone 同步「核心程式碼」，套加掛版補丁，重組 index，重產 manifest。
 *
 * 這是「純上游核心 + 外掛」架構的自動更新核心步驟，取代舊的整檔合併。
 *   前提：<upstream-dir> 是原作者 repo 的本機 clone，且已 checkout 到要同步的 commit。
 *   資產（assets/ public/）由呼叫端（GitHub Action）先用 rsync --delete 鏡像好，本腳本只碰程式碼與 manifest。
 *
 * 流程：
 *   1. 用上游原版覆蓋核心 js/NN-*.js 與 css/*（保留我方 afk-*.js、scripts/、tools/）。
 *   1.5 check-save-io.mjs：上游動到存檔寫入/壓縮就 exit 1（afk-synccompress 直接覆寫 _lzSet，格式一變會寫壞存檔）。
 *   2. index.html = 上游 index.html + 注入外掛區塊（scripts/afk-plugin-block.html）到 </body> 之前。
 *   3. 跑 apply-core-patches.mjs 把加掛版必要的核心鉤子補回去（錨點式，插不進就 exit 1）。
 *   4. 重產 anim-manifest / 對帳 manifest，stamp 版本號與 SW。
 *
 * 用法：node scripts/sync-upstream.mjs <upstream-clone-dir>
 */
import { readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const UP = process.argv[2];
if (!UP || !existsSync(join(UP, 'index.html'))) {
  console.error('用法: node scripts/sync-upstream.mjs <upstream-clone-dir>（該目錄需已 checkout 到目標 commit）');
  process.exit(1);
}

function run(cmd) { console.log('$ ' + cmd); execSync(cmd, { stdio: 'inherit' }); }

// ── 1) 覆蓋核心 js/NN-*.js 與 css/* ─────────────────────────────
//   只覆蓋「編號核心檔」；我方 js/sfx-index.js、js/anim-manifest.js（下面重產）不動。
const upJsFiles = readdirSync(join(UP, 'js')).filter((f) => /^\d\d?-.+\.js$/.test(f));
let copied = 0, added = 0;
for (const f of upJsFiles) {
  const dst = join('js', f);
  if (!existsSync(dst)) added++;
  copyFileSync(join(UP, 'js', f), dst);
  copied++;
}
for (const f of readdirSync(join(UP, 'css'))) copyFileSync(join(UP, 'css', f), join('css', f));
console.log(`[sync] 覆蓋核心 js ${copied} 支（新增 ${added}）+ css`);

// ── 1.5) 存檔寫入/壓縮把關（afk-synccompress 直接覆寫核心 _lzSet，格式假設一變就可能寫壞存檔）──
//   上游動到那段就 exit 1 停在這裡：人工比對後跑 `node scripts/check-save-io.mjs --accept` 再續。
run('node scripts/check-save-io.mjs');

// ── 2) 重組 index.html = 上游 + 外掛區塊 ────────────────────────
let idx = readFileSync(join(UP, 'index.html'), 'utf8');
const block = readFileSync('scripts/afk-plugin-block.html', 'utf8');
if (idx.indexOf('</body>') < 0) throw new Error('上游 index.html 找不到 </body>，無法注入外掛區塊。');
if (idx.indexOf('afk-toggles.js') >= 0) throw new Error('上游 index.html 竟已含 afk-toggles.js？請人工檢查。');
idx = idx.replace('</body>', block + '</body>');
writeFileSync('index.html', idx);
console.log('[sync] index.html = 上游 + 外掛區塊');

// ── 3) 套核心補丁（錨點式，插不進就 throw→exit1）──────────────────
run('node scripts/apply-core-patches.mjs');

// ── 4) 重產 manifest + stamp 版本 ──────────────────────────────
run('node tools/gen-anim-manifest.js');
run('node scripts/gen-manifests.mjs');
run('node scripts/stamp-code-versions.mjs');

// ── 5) 更新同步錨點（upstream-checkpoint.json）─────────────────
//   ⚠ 必須排在 stamp-sw-version 之前：version.json 的 upstreamAt（首頁「最後同步原版」那行）讀的就是這裡的 syncedAt，
//     順序反了會永遠慢一次同步。
//   clone 需帶 .git（rev-parse 取目前 checkout 的 commit）；沒有就跳過並警告（不擋流程）。
try {
  const upSha = execSync('git -C "' + UP + '" rev-parse HEAD', { encoding: 'utf8' }).trim();
  const upVer = (readFileSync(join(UP, 'js', '00-data.js'), 'utf8').match(/GAME_VERSION = '([^']+)'/) || [])[1] || '?';
  const ck = JSON.parse(readFileSync('upstream-checkpoint.json', 'utf8'));
  ck.syncedUpstreamCommit = upSha;
  const t = new Date(Date.now() + 8 * 3600 * 1000);   // 台灣時間（不可依賴 TZ 環境變數）
  ck.syncedAt = t.toISOString().slice(0, 16).replace('T', ' ') + ' (UTC+8)';
  ck.note = '由 sync-upstream.mjs 自動更新；上游 GAME_VERSION ' + upVer + '。架構=純上游鏡像+外掛層，syncedUpstreamCommit=目前核心/資產鏡像的上游 commit。';
  writeFileSync('upstream-checkpoint.json', JSON.stringify(ck, null, 2) + '\n');
  console.log('[sync] upstream-checkpoint.json → ' + upSha.slice(0, 9) + '（' + upVer + '）');
} catch (e) {
  console.warn('[sync] ⚠ upstream-checkpoint.json 未更新：' + e.message);
}
run('node scripts/stamp-sw-version.mjs');   // 錨點更新後才 stamp，version.json 的 upstreamAt 才是這次同步的時間

// ── 6) 冒煙檢查（外掛掛點）──────────────────────────────────────
//   CI 想把 smoke 拆成獨立 step（失敗→開 issue 而非整包紅）時，設 AFK_SKIP_SMOKE=1 跳過這裡、自己另跑。
if (process.env.AFK_SKIP_SMOKE === '1') {
  console.log('[sync] AFK_SKIP_SMOKE=1 → 跳過 smoke（呼叫端自行執行 node scripts/smoke-hooks.mjs）');
} else {
  run('node scripts/smoke-hooks.mjs');
}

// ── 7) 外掛 DOM 錨點檢查（上游刪 id 的當天就要抓到）─────────────────
//   外掛靠 getElementById 讀上游的設定勾選框/容器。上游改版刪掉某個 id 時 getElementById 回 null，
//   依賴它的條件永遠不成立 → 那段功能安靜消失（無錯誤、無警告，smoke 也驗不到）。同步正是 id 消失的時機，
//   所以排在流程最尾：前面的產生性步驟都已完成，這裡失敗＝要去改外掛的錨點，不必重跑同步。
run('node scripts/check-dom-ids.mjs');

console.log('\n✅ sync-upstream 完成：核心已是上游原版 + 加掛版補丁，index/manifest/版本/checkpoint 已更新。');
