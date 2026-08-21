/* ============================================================================
 * load-testsave.mjs — 把 .testdata/ 的真實存檔灌進遊戲,供 Playwright 測試用
 *
 * 為什麼要有這支:玩家回報的問題有一大半在「新角色」上重現不出來(空背包/空倉庫/
 *   Lv1 技能/沒傭兵),而「重現不出來」很容易被誤讀成「沒問題」。踩過很多次。
 *
 * 用法(在測試腳本裡):
 *   import { loadTestSave } from '../scripts/load-testsave.mjs';
 *   await loadTestSave(page, { file: 'save1.json', slot: 1 });
 *
 * 灌檔流程比照 js/13 的匯入:存檔 blob 內的 wh(倉庫)/pets 是「共用桶」、不在存檔位裡,
 *   要拆出來各自寫;其餘欄位才寫進 lineage_idle_save_<slot>。
 *
 * 📦 .testdata/ 裡有**兩種格式**(細節見 .testdata/_README.md):
 *   - 單存檔位(遊戲內「匯出存檔」):最外層是 SIG1 簽章字串 → loadTestSave / slotSaveToKeys
 *   - 整包 localStorage(外掛「完整備份」):{"format":"idle-lineage-full","keys":{…}} → fullBackupKeys
 *   兩種最後都能收斂成「一包 localStorage key/value」交給 injectKeys,測試腳本就不必分兩套寫法。
 * ========================================================================== */
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const DIR = new URL('../.testdata/', import.meta.url);
const FULL_FORMAT = 'idle-lineage-full';

export function listTestSaves() {
  try { return readdirSync(DIR).filter((f) => /\.json$/i.test(f) && !f.startsWith('_')); }
  catch (e) { return []; }
}

/** 讀 .testdata/<file> 原文(找不到就把現有清單印在錯誤裡,省得再去翻資料夾) */
export function readTestSave(file) {
  const url = new URL(file, DIR);
  if (!existsSync(url)) throw new Error('找不到 .testdata/' + file + '(現有:' + readdirSync(DIR).join(', ') + ')');
  return readFileSync(url, 'utf8');
}

/** 這份是不是「整包 localStorage 備份」 */
export function isFullBackup(raw) {
  try { return JSON.parse(raw).format === FULL_FORMAT; } catch (e) { return false; }
}

/** 整包備份 → localStorage 的 key/value 物件(原樣,不解讀內容) */
export function fullBackupKeys(raw) {
  const d = JSON.parse(raw);
  if (d.format !== FULL_FORMAT) throw new Error('不是整包備份(format=' + d.format + ')');
  return d.keys || {};
}

/**
 * 單存檔位的檔 → localStorage 的 key/value 物件。
 * 需要遊戲的 _saveWrap/_lzSet 才能包成存檔格式,所以**要在已載入遊戲的分頁上跑**;
 * 拿到 key/value 之後就能丟給全新的分頁 injectKeys(量效能時每輪都該用全新分頁)。
 */
export async function slotSaveToKeys(page, { raw, slot = 1 } = {}) {
  const r = await page.evaluate(({ raw, slot }) => {
    const u = _saveUnwrap(raw);
    if (!u || !u.payload) return { err: '解不開存檔簽章(檔案格式不對?)' };
    const d = JSON.parse(u.payload);
    const c = {};
    for (const k in d) if (k !== 'wh' && k !== 'pets') c[k] = d[k];   // wh/pets 是共用桶,不屬於存檔位
    const out = {};
    if (d.wh) { try { out[whKey(d.p)] = 'RAW:' + JSON.stringify({ items: d.wh.items || [], gold: d.wh.gold || 0 }); } catch (e) {} }
    out['lineage_idle_save_' + slot] = 'RAW:' + _saveWrap(JSON.stringify(c));
    // 離線結算要知道「關遊戲時人在哪張圖」——單存檔位的檔沒有 afk_map_<slot>,從 blob 的 ms.current 補
    const map = d.ms && d.ms.current;
    if (map) out['afk_map_' + slot] = map;
    return { out };
  }, { raw, slot });
  if (r.err) throw new Error(r.err);
  // 'RAW:' 前綴是為了讓 injectKeys 知道「這份還沒壓縮」——壓縮交給遊戲自己的 _lzSet 在頁面內做
  return r.out;
}

/**
 * 把一包 key/value 寫進當前分頁的 localStorage(先清空)。
 * 要在**與遊戲同 origin、但還沒載入遊戲**的頁面上跑(如 scripts/afk-plugin-block.html),
 * 否則遊戲會先用空 localStorage 跑起來。
 *   offlineHours 有給 → 順便把 afk_ts_<slot> 設成「現在 − N 小時」,載入該格就會觸發離線結算。
 */
export async function injectKeys(page, { keys, slot = 1, offlineHours = 0 } = {}) {
  return page.evaluate(({ keys, slot, offlineHours }) => {
    localStorage.clear();
    let n = 0;
    for (const k in keys) {
      let v = keys[k];
      if (typeof v === 'string' && v.slice(0, 4) === 'RAW:') v = v.slice(4);
      try { localStorage.setItem(k, v); n++; } catch (e) { /* 配額爆了就跳過該筆,其餘照灌 */ }
    }
    if (offlineHours > 0) localStorage.setItem('afk_ts_' + slot, String(Date.now() - offlineHours * 3600 * 1000));
    return n;
  }, { keys, slot, offlineHours });
}

export async function loadTestSave(page, opts = {}) {
  const files = listTestSaves();
  if (!files.length) throw new Error('.testdata/ 沒有存檔——請先放一份進去(該資料夾已 gitignore)');
  const file = opts.file || files[0];
  const url = new URL(file, DIR);
  if (!existsSync(url)) throw new Error('找不到 .testdata/' + file + '(現有:' + files.join(', ') + ')');
  const raw = readFileSync(url, 'utf8');

  const r = await page.evaluate(({ raw, slot }) => {
    const u = _saveUnwrap(raw);
    if (!u || !u.payload) return { err: '解不開存檔簽章(檔案格式不對?)' };
    const d = JSON.parse(u.payload);
    const c = {};
    for (const k in d) if (k !== 'wh' && k !== 'pets') c[k] = d[k];   // wh/pets 是共用桶,不屬於存檔位
    if (d.wh) { try { _lzSet(whKey(d.p), JSON.stringify({ items: d.wh.items || [], gold: d.wh.gold || 0 })); } catch (e) {} }
    _lzSet('lineage_idle_save_' + slot, _saveWrap(JSON.stringify(c)));
    currentSlot = slot;
    loadGame();
    let wh = 0;
    try { const w = _lzGet(whKey()); wh = w ? (JSON.parse(w).items || []).length : 0; } catch (e) {}
    return { 職業: player.cls, 等級: player.lv, 背包: (player.inv || []).length, 倉庫: wh, 傭兵: (player.allies || []).length };
  }, { raw, slot: opts.slot || 1 });

  if (r.err) throw new Error(r.err);
  return r;
}
