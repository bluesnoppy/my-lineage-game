# 手機 / 平板版面規則

> 改任何「手機專屬」外掛(afk-mobile / battlehud / battlebuffs / mapbar / touchtip / toast / backnav…)或覆寫上游手機樣式前先讀本檔。核心的「不可停用基礎設施」兩條判準在 `CLAUDE.md`。

## 手機專屬元素在平板要「另一套版面」,不是把上游那條 media query 放寬

afk-mobile 的 `detectMobile()`(coarse 或寬 ≤820)比上游 CSS 的手機斷點(`max-width:768px` / `max-height:520px and pointer:coarse`)寬 → 平板直向落在縫裡:我方已切成單欄手機殼,上游眼中卻還是桌機(`#mobile-vitals` 不顯示、照抄上游條件的 `afk-battlehud`/`afk-battlebuffs` 也不生效)。

**放寬 MQ 是錯解**:上游那些樣式是「手機單欄版面的一員」(如狀態列的 `position:sticky;order:-11;width:100%`),平板的 `#game-screen` 其實還是桌機三欄 flex → 元素變成第四欄,把戰鬥區與喝水鈕擠出畫面。正解=**同一支外掛做兩套版面、自己判在哪一套**(`afk-battlehud` 的 `inTabletGap()`/`placeStrip()`):

- 手機(上游那條窄 MQ 成立)→ 位置照舊:`#game-screen` 單欄流的第一個子項、sticky 釘頂。
- 平板缺口(`body.m-mobile` 在、窄 MQ 不成立)→ 掛自己的 `body.afk-hud-tab`,把元素**放進「目前顯示的那一欄」**(`#col-left/center/right`)當普通區塊;切分頁時跟著搬。
- ⚠ **`#game-screen` 是 `position:absolute`(釘在 `#app-stage` 裡)→ 放它「外面」當兄弟節點會被整張畫面蓋住**。
- ⚠ 元素的**內部外觀**(內距/顏色/血條)不要包在 media query 裡,不然平板模式只拿到骨架沒有樣式。整條沒啟用時本來就 `display:none`,無條件宣告不影響桌機。
- 這裡讀 `body.m-mobile` 是對的(不違反「不依賴可關外掛」):手機殼被關掉＝畫面回三欄,桌機完整狀態面板本來就看得到,這條不該出現。

判準:**問「手機殼套上了就該有它嗎?」是 → 該外掛必須在平板尺寸有一條生效路徑(自己的 body class),不是放寬上游那條 MQ;只是窄畫面排版優化(如 afk-mapbar 把標題列壓兩排)才單純留上游那條窄的。** smoke 第四輪已加檢查:平板 context 下,手機專屬外掛注入的樣式必須有「某條 `@media` 成立」或「某條 `body.afk-*` 規則的 class 真的掛在 body 上」。

## 覆寫上游「寫在 media query 裡」的樣式時,自己的規則要包進同一條 media query

afk-mobile 的 `detectMobile()` 跟上游 CSS 的手機斷點**判定範圍不一樣**——觸控平板在我們眼中是手機、在上游 CSS 眼中是桌機。只寫 `body.m-mobile` 就去覆寫上游手機版的 `top`/`height`,平板會拿到「我們的定位＋上游的桌機 transform」→ 兩套幾何混搭,元素被 `translate(-50%,-50%)` 推出畫面(城鎮 NPC 視窗踩過,top 到 −489、上半截全在畫面外,**手機與桌機都測不出來**)。

判準:**要覆寫的上游宣告是包在 media query 裡的嗎?** 是 → 自己的規則也包同一條;只有純位移／封頂(padding、max-height)這種「哪種幾何都成立」的才可以裸寫。**此規則已有 smoke 把關**:`smoke-hooks.mjs` 第四輪用 820×1180 觸控 context 驗「`#game-screen` 不捲時右欄分頁必須各自捲得動」,裸寫 `body.m-mobile` 覆寫上游手機規則會當場紅(捲動這組的條件常數=afk-mobile 的 `MOBILE_GEOM_MQ`)。

## 把長清單攤平成單層捲動,代價是全站每一次「讀版面」都變貴

afk-mobile ⑤ 為了避免雙層捲軸,把 `#tab-content-panel` 攤平交給 `#game-screen` 單層捲。副作用是整份背包變成一條數萬像素高的流(真實存檔 2083 件 → 防具分頁 1,405 列、近 58,000px),**瀏覽器一次就得把每一列都排版**;之後遊戲裡任何一次 `getBoundingClientRect()` / 設 `scrollTop` 都要重排整份清單(實測一次 82ms),而遊戲每秒做幾十次這種事(8fps 貼圖換向、狀態列對位、掉一件東西就重建清單)。**症狀不會指向清單**,而是「手指在滑的時候整個畫面閃爍破圖」(2026-08-10 玩家回報)。

解法是給每一列 `content-visibility: auto` + `contain-intrinsic-size`,讓捲出畫面的列不排版也不繪製(afk-invlist 已用;實測大卡頓一趟 6 次 → 1 次、有效 fps 30 → 51)。

⚠ **但要不要套,判準是「每一列多貴」,不是「清單多高」** —— 這條很反直覺,量過才知道。倉庫兩份清單合計 2,742 列、107,704px,**比背包還高一倍**,套下去卻幾乎沒用:一次強制重排 54ms → 40ms,滑動的掉幀與大卡頓完全沒變。原因是倉庫的列只是一顆 `<button>` 配一行字,排版本來就便宜;背包的列有圖示 `<img>`＋發光 class＋巢狀 flex＋角標,一列貴得多。
**驗這件事最快的方法是先量天花板**:把整份清單 `display:none` 再量一次強制重排 —— 倉庫的天花板是 36ms(對照原樣 54ms),也就是**再怎麼優化最多只省得到 18ms**,不值得。背包則是 117ms → 25ms,值得。

⚠ 另一個「不該套」的訊號:**列高不一致**。倉庫的列在 34/35px 之間跳,估值怎麼填都會差 —— 實測第一次滑過去時 400 步裡有 326 步發生最多 3px 的內容位移(第二趟才穩,因為 `auto` 已記住實測值)。背包的列 1,405 列全部剛好 38px,所以零位移。

⚠ `contain-intrinsic-size` 給的是**內容框**高度,padding 與框線瀏覽器會自己加 —— 填 border-box 的值會讓捲動高度多算三成(踩過:58,045 → 79,199)。

⚠ **量這類東西時,一定要先等離線補跑跑完**(`__afk.busy()` / `catchupActive()` / `state.ff` 都要是 false)。補跑是 91% duty cycle 的非同步迴圈,分頁剛載入時它還在跑,每一輪殘量不同 → 數字會漂到讓你得出完全相反的結論(這次先誤判成「濾鏡與發光動畫是主因」,重量後兩者其實都量不出差別)。

## 手機的檢視 class 只有 `mview-left` / `mview-center` / `mview-right`——沒有 `mview-battle`

外掛要判斷「現在在不在戰鬥那一欄」時,**戰鬥＝`mview-center`**(名字的單一真實來源是 afk-mobile 的 `setView()`,它只會加這三個)。寫成不存在的名字**不會報錯**,只會讓條件恆真/恆假 → 元素在手機上永遠不出現(或永遠不隱藏),而且**畫面上完全看不出是誰把它藏起來**,很容易往「z-index/版面被蓋住」的方向查半天(afk-training 的木人場 DPS HUD 就這樣在手機上從來沒出現過;afk-dograce 當初也踩過,才在原地留了警告註解)。

同組還有一個:切分頁的鈕在 `#m-nav` 裡,屬性是 **`data-view`**(值同上三選一),不是 `data-nav`——選擇器寫錯一樣是安靜失效(`querySelector` 回 null → 那行 click 沒發生,使用者得自己切分頁)。

判準:**要打 `mview-` 或 `#m-nav` 的選擇器前,先去 afk-mobile 的 `setView()` / nav 建立處確認名字**,不要照記憶或照別處抄。smoke 驗不到這類「名字拼錯」——它只確認外掛有載入,不會知道你想找的 class 從來不存在。

## 圖變成「白色人形」不是圖壞了,是手機的自動深色主題在反轉——頁面要自己宣告 `color-scheme: dark`

Android Chrome 的「自動深色主題」只對**沒宣告自己支援深色**的頁面出手,而且對圖片是**逐張啟發式判定**:判成圖示類的整張反白、判成照片類的放過。所以症狀長這樣——部分 NPC/怪物變白色人形、旁邊那隻卻好好的;每次中的不是固定幾隻;**重繪、換地圖、重新登入、清快取通通無效**(那是畫的時候才套的濾鏡,資料本來就是好的),重裝 App 才恢復,過一陣子(手機自己進深色/省電模式)又發作。

**極容易誤判成自己的 bug**:2026-08-05 這支就先被歸因成「瀏覽器把解碼資料丟掉」,還為此加過「回前景重建清單」的無效修正(已 revert)。分辨方法:把圖丟進 canvas 讀像素——**讀回來是正常顏色、畫面上卻是白的**,就是瀏覽器在畫的時候才反轉,跟我們的資料無關。

修法只有一行(已在 `scripts/afk-plugin-block.html` 與 index.html):`<style>:root{color-scheme:dark}</style>`,smoke 有守。本機重現方式:`chromium.launch({ args: ['--blink-settings=forceDarkModeEnabled=true,darkModeImagePolicy=1'] })`(`=1` 就是 Android 那個「聰明」模式,`=0` 是全部反轉、反而看不出選擇性)。

## 新增「釘在畫面上」(fixed/sticky)的手機元素 → 自己量橫幅,並用「帶文字」的假橫幅驗遮蔽

橫幅 z-index 是 int 上限、壓得過任何外掛,而各外掛認橫幅是**比對文字**(`/shines871|官方|非官方|轉載/`,見 findBanner)——**沒文字的假橫幅在偵測邏輯眼中不存在**,只測得到「z-index 硬蓋」,驗不到「量測→讓位」那條路徑(smoke 第三輪的假橫幅原本就漏了文字,已補)。

判準:元素釘死在頂端 → ①讓位讀 `--orig-bar-h` / `AFK_BANNER`(afk-banner 提供、不可停用),真的要自己量就照 findBanner 那組特徵 ②測試裡的假橫幅要有文字。
