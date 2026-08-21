# Service Worker / PWA(`sw.js` 是我方檔,上游無 PWA)

> 動 `sw.js`、快取策略、圖桶對帳前先讀本檔。

- **雙桶分離**:程式桶 `code-v1`(固定桶名;js/css/index/manifest/圖示;導覽 network-first、資源 cache-first 帶 `?v=`)+圖桶 `img-v3`(固定桶名;assets 全部,純 on-demand)。失效走**對帳**不整桶倒:程式桶 reconcileCode(DOM 現行引用清單)、圖桶逐張(assets-manifest 的 blob sha)、動畫逐怪(anim-manifest)。
- **🚨 SW 不可對圖桶 `cache.keys()`**——筆數多會拋 `Operation too large` 整支對帳靜默掛掉;列舉不到時什麼都別做;清之前先確認記錄寫得進去。程式桶(數十筆)可以。
- **`cache.put` 條件一律 `res.status === 200`(不是 `res.ok`,206 會 reject)且永遠掛 catch**;音檔(bgm/sfx)fetch 不攔截。
- **install 刻意不 `skipWaiting`**(常駐請求會讓交接死鎖、首頁卡半分鐘);activate 只留 claim。搬家/清理不可寫在 activate。
- **改任何程式檔後 push 前 `node scripts/stamp-sw-version.mjs`**(讓 sw.js 位元組變→PWA 偵測更新;`CODE_VERSION` 只當觸發器不當桶名;漏跑有 `prepush-guard` hook 擋)。**動 assets 後 `node scripts/gen-manifests.mjs`**(+動畫另有 `node tools/gen-anim-manifest.js`,sync 腳本都會跑)。判準:凡「URL 含 `/assets/`、會被圖桶快取」的圖必須在某份對帳清單裡,否則換圖卡舊。
- afk-diag 取證:欄位各自包錯(一個 API 炸不可帶走整份)、唯讀硬性要求、產物自帶版本號;`CODE_VERSION` 不含 sw.js 自己——改 sw.js 版本號不變,判 SW 新舊靠新欄位/`reg.waiting`。
