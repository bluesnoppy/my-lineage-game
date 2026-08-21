/* ============================================================================
 * core-file-guard.mjs — PreToolUse hook:擋下「用 Edit/Write 直接改上游鏡像檔」
 *
 * 本專案是「上游原版鏡像＋外掛層」:`js/NN-*.js`、`css/*`、`index.html`、
 * `assets/`、`public/` 全是上游原檔的位元組級鏡像,下次同步會整包覆蓋 →
 * 手改的東西**默默消失**,而且改的當下一切正常、完全看不出來。
 *
 * 因此這幾類路徑只能由腳本產生(sync-upstream / apply-core-patches / gen-manifests
 * 都是 node 直接寫檔,不經 Edit/Write 工具),人/Claude 一律走外掛層。
 *
 * 命中 → exit 2 擋下並提示正確作法;其餘一律放行。
 * ========================================================================== */
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, sep } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readStdin() {
  return new Promise((r) => {
    let s = '';
    process.stdin.on('data', (c) => (s += c));
    process.stdin.on('end', () => r(s));
    process.stdin.on('error', () => r(s));
  });
}

const raw = await readStdin();
let data = {};
try { data = JSON.parse(raw); } catch {}

if (!/^(Edit|Write|MultiEdit)$/.test(data?.tool_name || '')) process.exit(0);
const fp = data?.tool_input?.file_path;
if (!fp) process.exit(0);

// 只管本 repo 內的檔(hook 雖是專案層級,cwd 仍可能在別處)
const rel = relative(ROOT, resolve(fp)).split(sep).join('/');
if (!rel || rel.startsWith('../')) process.exit(0);

const HOW = '正確作法:①行為 → 寫成 `afk-*.js` 外掛 monkey-patch;②外掛包不住 → 加錨點補丁到 `scripts/apply-core-patches.mjs`;③樣式 → 寫在外掛注入的 <style>;④index.html → 改 `scripts/afk-plugin-block.html`。細節見 CLAUDE.md「修改原則(鐵則)」。';

let why = null;
if (/^js\/[^/]+\.js$/.test(rel)) why = `${rel} 是上游核心 js 的鏡像`;
else if (/^css\/[^/]+\.css$/.test(rel)) why = `${rel} 是上游 css 的鏡像`;
else if (rel === 'index.html') why = 'index.html 由 sync 腳本用「上游 index＋afk-plugin-block.html」重組';
else if (/^(assets|public)\//.test(rel)) why = `${rel} 在 assets/public 底下,CI 同步時會被 rsync --delete 刪掉`;

if (why) {
  console.error(`⛔ 不要直接改上游鏡像檔:${why},下次同步上游會整包覆蓋、改的東西會默默消失。\n${HOW}`);
  process.exit(2);
}
process.exit(0);
