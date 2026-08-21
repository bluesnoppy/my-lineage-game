# 同步上游的細節(SOP 本體跑 `/sync-upstream` skill)

> 使用者說「同步原版/更新上游」→ 跑 `.claude/skills/sync-upstream/`。本檔只放 skill 之外要知道的背景。

## 摘要

1. `git -C <clone> fetch` + checkout 目標 commit(通常 origin/main)。上游本機 clone:`D:/otherPersonRepos/idle-lineage-class`。
2. **assets 鏡像**:比對要用 **blob sha**(`git ls-files -s`),不能只比檔名——「兩邊都有但內容不同」佔過大宗(踩過:一次 10,149 檔)。補檔用 tar 走檔案清單(中文檔名不經 exe 參數);**上游沒有的檔要刪**(assets 已於 2026-07-19 達成純鏡像,刪前仍 grep `afk-*.js`+`scripts/` 確認外掛層沒引用)。
3. `node scripts/sync-upstream.mjs <clone>`:覆蓋核心 js/css → **check-save-io** → 重組 index.html(上游+外掛區塊) → apply-core-patches → 重產 manifest → stamp 版本 → smoke。**錨點失效會 exit 1** → 讀上游該處 diff、更新補丁錨點再跑。
4. 更新 `upstream-checkpoint.json` → commit(不主動 push)。
5. 後續:小百科/掉落查詢要另跑 `/update-wiki` 對齊;上游 commit message 全是「1」不可依賴,一律讀 diff。

## `scripts/check-save-io.mjs`(存檔寫入/壓縮把關)

`afk-synccompress` 是唯一「整支覆寫核心存檔函式」的外掛(換掉 `_lzSet`、自己拼 `"LZ1:"+compressToUTF16`、bump `_lzWorkerRev`、退路呼叫 `_lsSet`)。上游一改存檔格式/Worker 對帳,開著那支的玩家就會被寫出**讀不回來的存檔**,而 smoke 只驗掛點、驗不到。故同步時逐支比對這組核心函式的 sha(基準存在 `upstream-checkpoint.json` 的 `saveIo`),變了就 exit 1。

處理:讀 diff → 判斷外掛要不要跟改(有疑慮先在 afk-toggles 給 `synccompress` 加 `locked` 鎖起來) → 確認安全再 `node scripts/check-save-io.mjs --accept` 收下新基準。

## CI 版(GitHub Actions `sync-upstream.yml`)

**只有 `workflow_dispatch`,無 GitHub schedule;目前完全沒有定時觸發,同步時機由人決定**——`cf-sync-trigger/` 的 Cloudflare Worker 還在,但 cron 已於 2026-07-21 清空(`crons = []`,API 查 schedules 為空)。要恢復每天自動:把 `wrangler.toml` 的 `crons` 填回 `["20 10 * * *"]`(=台灣 18:20)再 `npx wrangler triggers deploy`;不用 GitHub 自家 schedule 是因為它常延遲 1~2 小時。

流程跟手動同一套:ls-remote 比 checkpoint 早退 → 鏡像資產(`rsync --delete`)→ sync 腳本(AFK_SKIP_SMOKE=1)→ smoke → **全綠直推 main(Pages 自動部署)+ 發 Release(tag `vYYYYMMDD-HHMM`,標題帶原作者版本號)**;錨點失效/smoke 紅 → 各開 issue、不推壞版。commit 用路徑白名單 add(CI 臨時裝的 playwright/package.json 不進版控)。

⚠️ **因此 `assets/`、`public/` 下不可放我方獨有檔案**(會被 `--delete` 刪)——外掛需要圖優先引用上游既有檔(例:afk-training 背景用 `assets/area/1920x1080/新兵修練場.jpg`);真的要自有素材就放 assets 之外,或改 workflow 加 exclude。
