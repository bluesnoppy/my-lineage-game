#!/usr/bin/env node
/* ============================================================================
 * check-toggle-deadend.mjs — 抓「關掉之後就再也開不回來」的外掛開關
 *
 * 為什麼要這支:純新增型外掛的標準寫法是檔頭早退
 *     if (window.AFK_TOGGLES && !AFK_TOGGLES.enabled('x')) return;
 *   而它自己的 `AFK_TOGGLES.register(...)` 往往寫在檔案**下面**。玩家把它關掉之後,
 *   下次載入會在 register 之前就 return → 那一項從開關面板整個消失 → **玩家再也開不回來**,
 *   而且畫面上不會有任何錯誤,只會覺得「這個設定怎麼不見了」。
 *
 *   玩家實際踩過:把 lzcache 關掉之後就再也找不到那個設定項——而它正是讓結算快好幾倍的那支。
 *
 * 判準:某支外掛裡出現「enabled('x') 就 return」的早退,而 'x' 既不在 afk-toggles.js 的內建目錄裡、
 *   該檔的 register 又排在早退之後 → 就是死結。
 *
 * 修法:把該 id 補進 afk-toggles.js 的內建目錄(那張表存在的理由就是這個——
 *   「先自動登錄,面板一定列得出來,就算那支外掛整個沒載入也能被開/關」)。
 *
 * 用法:node scripts/check-toggle-deadend.mjs   → exit 1 = 有死結
 * ========================================================================== */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const tog = read('afk-toggles.js');
// 內建目錄那張表:{ id: 'xxx', name: … } 的字面值(register 的呼叫也長這樣,一起收進來無妨——
// afk-toggles 自己的 register 就是拿這張表餵的)
const catalogue = new Set([...tog.matchAll(/\{\s*id:\s*'([\w-]+)'/g)].map((m) => m[1]));

const files = readdirSync(ROOT).filter((f) => /^afk-.*\.js$/.test(f) && f !== 'afk-toggles.js');
const dead = [];
for (const f of files) {
  const src = read(f);
  const regAt = src.search(/AFK_TOGGLES\.register\(/);
  for (const g of src.matchAll(/AFK_TOGGLES\.enabled\('([\w-]+)'\)\)\s*return[;\s]/g)) {
    const id = g[1];
    if (catalogue.has(id)) continue;                       // 內建目錄有 → 面板一定列得出來
    if (regAt >= 0 && regAt < g.index) continue;           // 自己在早退之前就登錄過 → 安全
    dead.push({ file: f, id, line: src.slice(0, g.index).split('\n').length });
  }
}

if (!dead.length) {
  console.log(`✅ 沒有「關掉就開不回來」的外掛開關(掃了 ${files.length} 支)。`);
  process.exit(0);
}
console.error('❌ 這些外掛一旦被玩家關掉,開關面板上那一項就會消失、再也開不回來:');
for (const d of dead) console.error(`   ${d.file}:${d.line}  id=${d.id}`);
console.error('\n修法:把上面的 id 補進 afk-toggles.js 的「內建外掛目錄」那張表(name/desc/group/def 照該外掛自己的 register 抄一份)。');
process.exit(1);
