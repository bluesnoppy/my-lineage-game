---
name: release
description: 放置天堂加掛版發版 — 用「日期 tag + 原作者版本號」開一個 GitHub Release（與同步 CI 同一套規則）。當使用者說「發版」「發 Release」「出新版」「發佈新版本」或 /release 時使用。
disable-model-invocation: true
---

# /release — 發版 SOP

tag 與標題**與 `.github/workflows/sync-upstream.yml` 的自動發版同一套**；差別在說明——同步 CI 是「跟到上游就自動發」、它沒有改動清單可寫，人工發版有。

- tag：`vYYYYMMDD-HHMM`（台灣時間）
- 標題：`《<遊戲名>》加掛版 <TAG>（原版 <上游 GAME_VERSION>）`
- 說明：**固定開頭段 + 這次的改動清單 + 固定結尾兩行**（2026-08-01 起；先前「一律固定文字、不列清單」的規定已由使用者取消）

> 不再維護加掛版自己的 semver。`version.json` 的 `app` 欄位已無人顯示（afk-syncinfo 首頁只顯示「最後同步原版 <buildAt>」），發版**不要**去動它。

## 步驟

1. **確認狀態乾淨且已上線**
   - `git fetch origin && git status`：工作區要乾淨、本地不落後 origin/main。
   - 有未 push 的改動 → 先走 `/prepush` + push、等 GitHub Pages 上線，再回來發版（發版對象必須是線上已生效的內容）。

2. **取兩個變數**
   ```bash
   TAG="v$(date -u -d '+8 hours' +%Y%m%d-%H%M)"                                   # 台灣時間（git-bash 的 TZ= 不生效）
   VER=$(sed -n "s/.*GAME_VERSION = '\([^']*\)'.*/\1/p" js/00-data.js | head -1)  # 上游版本號
   GAME=$(sed -n 's/.*<title>\([^<]*\)<\/title>.*/\1/p' index.html | head -1)     # 遊戲名
   ```
   三個都要有值才往下走（空值代表核心結構被改過，停下來回報）。

3. **整理這次的改動**
   - `git log <上一個 v20* tag>..HEAD --oneline`，把 `stamp:`／`bump`／`docs` 那類雜訊濾掉。
   - **只寫玩家有感的、用玩家的話寫**：不要出現外掛檔名、函式名、commit hash、內部機制。
     判準同 `CLAUDE.md`「玩家看得到的字」那節——這句會讓他做出不同的動作嗎？不會就刪。
   - 依性質分段（離線掛機／存檔／倉庫／小百科／新功能／修正…），一段幾條就好，不要逐筆流水帳。

4. **寫說明檔**（中文走檔案、不走命令列參數，避免 git-bash 重編碼）
   - 用 Write 工具寫 `.scratch/relnotes.md`：**固定開頭段 → 改動清單 → 固定結尾兩行**。
     頭尾這幾行與 `.github/workflows/sync-upstream.yml` 的 `printf` 範本同源（CI 自動發版只有頭尾、沒有中段），
     改頭尾要順手同步那邊；中段的改動清單是人工發版才有的，CI 不需要跟。

     ```
     《<遊戲名>》加掛版 — 已同步原作者最新版（原版版本 <原版版本>），外掛層照常疊加、不改動原遊戲內容（手機版面／掉落查詢／小百科／木人場／賽狗場等，遊戲內「外掛開關」可逐一管理）。

     ## 這版改了什麼

     ### <分段標題>
     - <玩家看得懂的一句>

     原始碼請由下方 Source code (zip / tar.gz) 下載。
     線上遊玩：https://pp771007.github.io/idle-lineage-class/
     ```

5. **打 tag + 開 Release**
   ```bash
   git tag "$TAG" && git push origin "$TAG"
   gh release create "$TAG" --title "《${GAME}》加掛版 ${TAG}（原版 ${VER}）" --notes-file .scratch/relnotes.md
   ```
   - 同名 tag 已存在（同一分鐘內重跑）→ 等一分鐘換新 TAG，不要 `-f` 覆蓋既有 release。
   - 用完刪掉 `.scratch/relnotes.md`。

6. **回報**：附 Release 連結給使用者（訊息從 Telegram 來就用 reply）。

## 判準備忘

- **不 bump 任何版本號、不 commit、不用等 Pages**：這支只打 tag + 開 Release，不動 repo 內容（跟舊版最大的差別）。
- 舊的 semver tag（`v3.4.x`）留著當歷史，不要再往下接——`version.json` 的 `app` 停在 `3.4.10` 是已知且無害的（沒有任何畫面讀它）。
