---
name: update-wiki
description: 放置天堂小百科/掉落查詢的更新 SOP — diff 驅動、逐檔逐頁機械式對照「上游遊戲資料的變動」(錨點=wiki-checkpoint 的 reconciledUpstreamCommit,diff 在上游 clone 做,上限=已同步到的 syncedUpstreamCommit),補進 afk-wiki.js / afk-dex.js / afk-extradata.js,測過再更新 checkpoint。當使用者說「更新小百科」「同步小百科」「補小百科內容」或 /update-wiki 時使用。
disable-model-invocation: true
---

# /update-wiki — 小百科更新 SOP(純上游鏡像架構版)

對應 CLAUDE.md「📚 小百科/掉落查詢維護」。**這是 diff 驅動、機械式逐項對照的流程,絕不可憑印象判斷「前面做過了」就跳步**(踩過漏整個模式)。

架構=純上游鏡像+外掛(2026-07-19 起):遊戲資料的變動來源**只有上游同步**,所以 diff 一律在**上游 clone**(`D:/otherPersonRepos/idle-lineage-class`)做,錨點記「上游 commit」:
- **BASE**:`wiki-checkpoint.json` 的 `reconciledUpstreamCommit`(小百科已反映到哪個上游 commit)。
- **TARGET**:`upstream-checkpoint.json` 的 `syncedUpstreamCommit`(遊戲現在鏡像到哪)。**只能對齊到這裡**——上游更新但還沒 sync 的部分,遊戲裡沒有,不要提前寫進小百科(先跑 /sync-upstream)。

## 鐵則(動手前先記住)

- 🔴 **先 `git fetch origin && git pull --rebase origin main`**(本 repo,別的 session/裝置可能推過),並 `git -C <clone> fetch` 確認 clone 不是舊的。
- 🔴 **diff 要整段逐項勾過**,即使覺得做過了也要看完。
- 🔴 **diff 不只看「新增的資料定義」,更要看「既有公式/機制被改」**——機制改動不會以新 `sk_`/`item` 出現,純掃新增一定漏。重點讀 `js/02-stats`、`js/04-combat`、`js/01-drops`、`js/05-kill` 裡**被修改的成對 `-`/`+` 行**。
- 🔴 **同一主題的 wiki 內容可能同時存在兩處:「資料陣列」(如 `COMBAT_SECTIONS`)和「自寫 render 函式」(如 `renderMode` 自己 inline 建表)。改了 grep 命中的那處 ≠ 改完。** 判準:改完**一定要 render 實測那一頁**(步驟 5),不能只靠 Edit 成功就當完成(踩過)。
- 🔴 上游 commit message 全是「1」,一律讀 diff 本身。

## ⚠️ 轉換期一次性任務(做完把 checkpoint note 裡的旗標拿掉)

2026-07-19 改鏡像架構時,遊戲一口氣進了**所有**上游功能——包含舊「選擇性移植」時代各輪**未移植/略過**的項目(它們從沒進過小百科)。首次跑本 skill 時,除了 BASE..TARGET diff,還要:
1. 翻 `upstream-reviews/*.md` 四份報告的「移植進度總表/移植狀態欄」,列出所有 **未移植/使用者略過** 的項目——這些現在都在遊戲裡了,逐項確認小百科/掉落查詢有沒有反映,沒有就照本 SOP 補。
2. 完成後在 `wiki-checkpoint.json` 的 note 註明「舊報告未移植項已全數掃過」,之後的輪次就不用再翻舊報告。

## 步驟

1. **同步 + 取錨點**
   - `git fetch origin && git pull --rebase origin main`;`git -C <clone> fetch origin --quiet`。
   - BASE=`wiki-checkpoint.json` 的 `reconciledUpstreamCommit`;TARGET=`upstream-checkpoint.json` 的 `syncedUpstreamCommit`(別用 git log 猜)。BASE==TARGET 且無轉換期任務 → 回報「無需更新」結束。

2. **列出所有變動的檔(不挑)**
   - `git -C <clone> diff BASE..TARGET --stat -- js/ css/`
   - 清單上每個有變的檔都要讀,不可只挑「看起來有新東西」的。

3. **逐檔讀完整 diff,照「檔 → 負責頁」對照表歸位**(`git -C <clone> diff BASE..TARGET -- js/<檔>`,新增的 `+` 與修改的 `-`/`+` 成對都讀):

   | 改到的檔 | 看什麼 | 對應頁 / dex |
   |---|---|---|
   | `00-data` | 新 技能/物品/套裝/武器/地圖/怪 | 職業魔法·裝備(自動) / 套裝 SETS(手動) / 掉落查詢 |
   | `01-drops` | 掉率、世界模式(席琳一般/瘋狂)、恩賜 | 席琳 / 掉落查詢 / 戰鬥機制 |
   | `02-stats` | 屬性/衍生值公式、buff、封頂 | 能力值 / 技能效果 |
   | `03`-`04` combat | 傷害公式、命中、武器特效 proc、強化倍率、異常狀態 | 戰鬥機制 / 武器特性 / 強化 |
   | `05`-kill | 條件式掉落(`if … gainItem`)、經驗/升級 | 掉落查詢 SPECIAL_BLOCKS |
   | `06`-status-allies | 新異常狀態 kind、傭兵、召喚 | 戰鬥機制 / 傭兵 / 帶寵物 |
   | `07`-`08` | 施法、裝備規則 | 職業魔法 / 裝備 |
   | `10`-ui-tabs | 物品說明產生器(buildItemDescHTML)、遺物說明 | 裝備(自動) / 遺物顯示 |
   | `11`-world-map | 地圖/領域 | 地圖 |
   | `12`-npc-quests | 任務/試煉/兌換、倉庫、收集冊 | 任務 / 掉落來源 / 卡片·裝備圖鑑 |
   | `13`-shop-save | 商店、存檔、遊戲模式(一般/經典/傳統) | 戰鬥機制(模式) / 卡片·裝備圖鑑(共用桶) |
   | `14`-craft-pandora | 製作配方、潘朵拉 | 製作 |
   | `15`-`16`、`18` | 卡片/裝備/道具收集(掉落、積分、共用、加成) | 卡片 / 裝備·道具圖鑑 |
   | `21`-relic-book | 遺物圖鑑 | 遺物相關頁 |
   | `22`-pets、`23`-summons | 寵物/召喚 | 帶寵物 |
   | `24`-pandora-relic-market | 遺物市場/流浪玩家收購 | 相關頁(必要時新開) |

4. **補內容(分自動 / 手動)**
   - **自動同步的**(`MASTERY_DATA`、`DB.skills`、`DB.items`、掉落表、`buildItemDescHTML`)通常不用改。
   - **手動維護的**才要補:`WEAPON_TRAITS`/`SETS`/`ENHANCE_SECTIONS`/`LOAD_SECTIONS`/`SHERINE_SECTIONS`/`PLEDGE_SECTIONS`/`TOWER_SECTIONS`/`QUEST_BY_CLASS`/`QUEST_COMMON`/`MAGIC_FACT`(職業魔法「實際數據」金框,在 `afk-wiki.js`)。
   - **⭐ 裝備頁篩選器的手動維護清單**(全在 `afk-wiki.js`,漏補不會報錯、只會安靜少東西):
     ① 上游**新增套裝** → 若名稱只寫在各件裝備的 `set` 欄位(沒進 `DB.sets`),補 `EQ_SET_CN_EXTRA`,否則 chip 會顯示「套裝：<第一件的名字>」。
     ② 上游**新增影響攻速的欄位** → 補 `hasteInfo`(靠欄位判斷、刻意不掃說明文字),否則「⚡ 影響攻速」篩不到那件。**套裝給的攻速**(真‧冥皇 5/5、席琳麗人 5/5)單件查不到,只能寫進攻速說明卡。
     ③ 上游**新增部位(slot)** → 補 `EQUIP_GROUPS` 一個桶;沒補的會落進「❓ 其他部位」(不會消失,但分類不對)。順手看 `afk-dex.js` 的 `IT_SLOT` 有沒有該 slot 的中文名(缺就會露出英文 key)。
     ④ 上游**新增觸發式效果欄位** → 命名含 `proc`(任何位置)會自動收進「觸發特效」;不含的要補 `EQ_PROC_FIELDS`。同理免疫類補 `EQ_IMM_EXTRA`(⚠ 名字含 `Dmg` 的是「打免疫該狀態的目標時加傷」,不是抗性,已排除)。
     驗法:`AFK_WIKI_API.goto({tab:'equip'})` 後開篩選面板,確認新套裝/新部位的 chip 名稱是中文、件數對得上;新效果用該標籤篩得到。
   - **⚠️ 讀遊戲全域一律用裸名 + `typeof X !== 'undefined'`**:掉落表那幾張(`DARK_WEAPON_DROPS` 等)在 `js/01-drops-config.js` 是**頂層 `const`**,**不會掛到 `window`** → 寫 `window['DARK_WEAPON_DROPS']` 永遠是 undefined,而且完全不報錯(只會少算怪、少算區域)。範本看 `afk-dex.js` 的 `_allTables`。
   - **⭐ 全域條件式掉落**(`if(條件) gainItem`,不在任一怪 MOB_DROPS)→ 補進 `afk-dex.js` 的 `SPECIAL_BLOCKS`(否則掉落查詢搜不到,聖地遺物踩過)。
   - **⭐ 新掉落表 / 客製製作 / 純兌換成品** → 比對原作 `_auditMobDrops` 讀哪些表照抄進 `buildIndexes`(表數以它為權威,別信文件裡的張數);客製製作(如 `DEMONKING_RECIPES`/`LUMIEL_RECIPES`)補進 `buildCraftIndex`+`renderCraft`;純兌換補 `afk-extradata.js` 的 `AFK_EXTRA.itemAcquire[id].short`。
   - **⭐ 翻譯**:渲染結果出現連續英文(HP/MP/BOSS/Lv 除外)就是漏翻 → 補對應表(`STATUS_LABEL`/`STAT_LABEL`/`AFK_EXTRA.mapName`;地圖漏翻 smoke 會擋)。
   - 內容鐵則見下方「內容準則」「版面預算」兩節,動筆前讀完。

5. **每動一頁就 Playwright 無頭實測該頁**:數據對、無漏翻英文、無 raw key(`sk_`/地圖 id)、無 JS error;關鍵數字用 `page.evaluate` 直接呼叫遊戲函式對。

6. **收尾**
   - `node scripts/stamp-code-versions.mjs`(`?v=` 自動對齊,含 afk-*.js)+ `node scripts/stamp-sw-version.mjs`(或直接跑 `/prepush`)。
   - 更新 `wiki-checkpoint.json`:`reconciledUpstreamCommit`=TARGET 完整 sha、`reconciledAt`=台灣時間(git-bash 用 `date -u -d '+8 hours'`),note 寫「逐檔對過、動了哪些頁」,跟改動一起 commit。

## 內容準則(使用者明訂,別再犯)

- **表格優先、有數據用數據**;程式查得到的數字優先「動態讀 DB/呼叫遊戲函式」產表;散文只留機制說明。表格已表達的不要在下面散文重述。
- **數據以「真正算它的那段 code」為準**,絕不抄遊戲說明文字/註解(常過時);白話零術語(不要 1D4/骰 19);AC 照遊戲顯示負值;寫「現況」不寫改版語氣;不要模糊詞(短時間/有機率)。
- **渲染內容絕不露英文**——狀態/數值名補對應表(`STATUS_LABEL`/`STAT_LABEL`/`AFK_EXTRA.mapName`);地圖漏翻有 smoke 自動擋。
- **掉率要把三個倍率一次講完**(席琳×3/瘋狂×5/恩賜×10;判準=該 roll 有沒有乘 `_dropMult` 系);「不吃倍率」的兩處都補:小百科該頁+dex `SPECIAL_BLOCKS` 的 dropmult 清單。⚠️ **經典模式沒有掉率懲罰**——`classicDropMult()` 上游 v3.0.85 起恆回 1(v3.0.82 也已移除經驗×0.5/金幣÷2),舊的「經典×1/10」與它的例外清單(試煉道具/遺物/卡瑞屠龍劍)全部作廢,不要再寫進任何頁。
- **條件式掉落(`if(...) gainItem`)都要在掉落查詢查得到**(掃 js/05/06 補 `SPECIAL_BLOCKS`);掉落表以 `_auditMobDrops` push 的那組為權威;客製製作結構(`DEMONKING_RECIPES`/`LUMIEL_RECIPES`…)dex+wiki 兩邊都補,**實測查得到才算數**;純兌換/無怪掉的補 `AFK_EXTRA.itemAcquire[id].short`;潘朵拉抽獎不列為取得方式(唯一來源也寫「目前沒有固定取得途徑」)。
- **不要用代名詞指涉怪物**(「牠」「牠們」)——一律寫具體名詞:怪／該怪／頭目／目標／對方。踩過:「剋牠 ×1.4、被牠剋 ×0.6」讀者得回頭找誰是誰(使用者回報);改成「你剋對方 ×1.4、對方剋你 ×0.6」就一眼懂。
- 裝備顯示一律重用 `buildItemDescHTML`,不自己刻數值格式。
- 介面:搜尋=統一結果(跨分頁跨職業,黃色高亮);分頁列單排橫捲;手機不加會撐高的標示元素。
- **只寫原作者原版的遊戲機制**,不寫我們外掛(離線掛機、手機版面等)的行為。

## 📏 版面預算與「別寫成散文」的替代手法

玩家抱怨「字太多」時,不要只刪形容詞——**把散文換成別的呈現形式**。量化預算(以改寫後的「強化」頁為基準:散文 805 字 / 14 則 / 最長 79 字 / 6 張表):

| 單位 | 目標 | 硬上限(超過就重構) |
|---|---|---|
| 一則要點(一個「・」) | ≤ 80 字 | 120 字 |
| 一張卡片的要點數 | ≤ 5 則 | 6 則→拆卡或改表 |
| 一頁的散文總量 | ≤ 1,000 字 | 1,500 字 |
| 頁首 note | 1~2 句(定義＋最該注意的一件事) | 3 句 |

純資料頁(魔法/裝備/製作/NPC:內容是動態表格與逐項清單)不受此預算約束;但**逐項描述本身也吃「一則 ≤ 80 字」**。量測法:render 後數 `.m-wiki-desc` 的 innerText 長度。

**替代散文的手法,依優先序**:

1. **表格**——凡「條件→數值」「部位→效果」「階級→加成」「來源→機率」一律走 `wTbl`(自帶橫捲容器)。欄數 ≤ 4;更寬的資料表獨立成卡。
2. **箭頭串接流程**:`開世界 → 打怪掉結晶 → 找伊奧換遺骸 → 湊套裝` 取代「先…接著…最後…」。
3. **✓／✗ 對照表**(經典模式頁已在用)取代「這個不能用、那個可以用」的句子。
4. **一行公式**(`≈（骰子＋魔法傷害＋固定加值）×…`)取代逐步文字推導。
5. **顏色/圖示當分類**(遺物藍字＋🏺、傳說金＋✦)取代「這是遺物」的說明文字。
6. **摺疊**:邊角規則收進可展開區(裝備頁 `m-eq-card` 已是此法),主視圖只留常用資訊。
7. **交叉連結**(`「套裝」`會被 `linkifyTabs` 自動變連結)——同一件事只在主場頁寫全,其他頁一句帶過。
8. **標題自帶結論**:卡片標題寫「+9 起成功率只剩 17%」這種可直接讀的結論,內文就不用再破題。

**不要為了短而砍掉的**:數據、機制、以及**策略建議句**(「對策:用魔法或帶貫穿武器」——使用者明講「策略挺好的,留著」)。要砍的是存讀檔/SL 那類與正常遊玩無關的敘述、講「這份小百科自己」的自我說明、以及同一件事的第二次重述。

**驗收(改完必跑)**:無頭 iPhone context 開 `?view=wiki` → 逐頁 `AFK_WIKI_API.goto({tab})` → ①`#m-wiki-body` 的 `scrollWidth === clientWidth`(沒有橫向溢出) ②沒有空的「・」(表格要走 `bulletHTML`/`wTbl`) ③`.m-wiki-desc` 沒有 >120 字的行。
