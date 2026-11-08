# 名片庫:名片 OCR 辨識資料庫

用手機或電腦拍名片 → 自動辨識成欄位 → 存進名片庫,之後用搜尋框即時找人。整個 App 是一個靜態網頁(原始碼在 `card_scanner/web/`,建置時內嵌成單一檔案 `dist/index.html`),名片資料只存在使用者自己的瀏覽器(IndexedDB),不經過任何伺服器。

## 快速開始

- **直接開**:下載 `dist/index.html`,用 Chrome / Edge / Safari 開啟即可(第一次使用 OCR 需要網路下載辨識引擎)。
- **本機伺服器**:`python -m card_scanner serve`,開 http://127.0.0.1:8780/ ;加 `--host 0.0.0.0` 讓同網段的手機也能開。
- **放到任何靜態網站**(GitHub Pages、公司內網網頁伺服器):把 `dist/index.html` 放上去即可。
- **GitHub Pages**:`.github/workflows/pages.yml` 在 `main` 分支有推送時自動測試、建置並發布(第一次請到 repo 的 Settings → Pages,把 Source 設為「GitHub Actions」)。網址為 `https://<帳號>.github.io/<repo>/`。注意 GitHub Pages 是公開網址,但名片資料存在各自的瀏覽器,不會出現在網站上。
- 修改 `card_scanner/web/` 後執行 `python -m card_scanner build` 重新產生 `dist/index.html`(測試會檢查它是否為最新)。

## 畫面:電腦版與手機版自動切換

依螢幕寬度自動切換(900 px 以上為電腦版),也可在「⋯ → 設定 → 版面」固定為其中一種;切換時正在編輯的內容會保留。

- **電腦版**:左邊是名片清單與快速索引,右邊是固定的編輯窗格。點名片或用 ↑↓ 鍵即時預覽,Enter 進入編輯,Esc 關閉;儲存後窗格停在同一張名片。換名片前若有未儲存的修改會先確認。上方有「匯入名片照片」(可多選),也可把照片拖進視窗或 Ctrl+V 貼上;電腦有相機時會出現「相機」按鈕。
- **手機版**:單欄的聯絡人清單、可左右滑動的分組與標籤列,底部有大顆的「掃描名片」按鈕,直接開啟相機取景;編輯畫面是全螢幕,儲存鈕固定在下方,輸入框用 16 px 字避免 iOS 自動放大。
- **相機取景**(需要 HTTPS 或 localhost,GitHub Pages 即可):畫面上有名片框,按快門只裁下框內的高解析影像;可切換直式名片、開補光燈(支援的手機)、「連拍」一次拍多張後按「完成」批次建檔。沒有相機權限或不支援時,可改從相簿選照片。

## 功能

- **掃描**:手機按「掃描名片」用相機拍,或從相簿 / 檔案選照片(可一次多選),電腦也可直接把照片拖進視窗或貼上(Ctrl+V)。單張會開啟編輯畫面,辨識到的欄位以綠底標示,核對後儲存;多張則逐張自動建檔並標為「待確認」,之後用「待確認」篩選逐一檢查。可旋轉照片、重新辨識、換照片。
- **三種 OCR 引擎**(「⋯ → 設定」切換):
  - 本機辨識(預設):[Tesseract.js](https://github.com/naptha/tesseract.js) 7 在瀏覽器內辨識,照片不離開裝置、免費。第一次使用從 jsdelivr 下載引擎與語言檔(繁中約 20 MB,之後瀏覽器會快取)。辨識前的影像處理(`imaging.js`、`ocr.js`):
    1. **找出名片並裁切、拉正**:以邊框顏色樣本判斷桌面背景,取最大的名片形狀區域(長寬比 1.2–2.4),依二階矩算出傾斜角後轉正、裁掉背景;再用文字列投影微調剩餘的小角度。存檔的照片也是裁切拉正後的名片。可在設定關閉。
    2. **判斷方向**:在縮小的影像上依序試 0° / 180° / 90° / 270°,以辨識可信度 × 有效字數挑出正確方向(倒置或側躺的照片也能辨識)。
    3. **去陰影、深底白字反相**:分區估計背景亮度並除掉,陰影與反光變均勻;以區塊亮度分布判斷文字極性,深色底的白字(深色名片、色帶上的地址)反相成白底黑字;清掉色塊交界的實心殘影與長直線。
    4. **放大到適合的字高**(名片寬約 1500 px),用稀疏文字模式(PSM 11)處理左右分欄、大小字混排;方向判斷時的小尺寸結果與正式辨識互補(可信度高的為主,另一份補缺漏欄位),兩份都偏低時再用自動版面分析(PSM 3)多跑一次。
    5. **錯字修正**(`parser.js`):電話裡的 O/I/l 改回 0/1、`©`→`@`、`.conm`/`.corn`→`.com`、「@」被認成「e@」時依英文姓名修正、「股份有○公司」→「股份有限公司」、職稱結尾差一字(如「事員」→「專員」)、名字旁的單一英文雜訊、被拆成兩行的地址。

    預設只載入繁中模型(英數字它也認得),英文為主的名片可改「繁體中文 + 英文模型」。辨識後由 `parser.js` 依規則判斷欄位(姓名、公司、部門、職稱、手機、電話、分機、傳真、Email、網站、地址、統編、LINE ID),處理全形字、中文字間多餘空白、「T: … F: …」同行多標籤、分欄等狀況。
  - MiniCPM-OCR(自架伺服器):OpenBMB 開源的 [MiniCPM-OCR 1.0](https://github.com/OpenBMB/MiniCPM-OCR)(1.3B 參數,Apache-2.0),以 OpenAI 相容 API 呼叫你自己架的 llama.cpp / Ollama / vLLM 伺服器,照片不經第三方。兩種方式:「逐字辨識 + 規則判斷欄位」(官方 `Text Recognition:` 提示,結果交給 `parser.js`,預設)或「模型直接擷取欄位」(官方關鍵資訊擷取格式,回傳名片欄位 JSON)。送出的是裁切拉正後的名片,取樣參數照官方範例(temperature 0.01、top_p 0.001、top_k 1、關閉 thinking)。伺服器連不上時自動改用本機辨識。架設方式見下方〈MiniCPM-OCR 伺服器〉。
  - Claude 視覺辨識:照片傳給 Claude(預設 `claude-opus-5-5`,可改 Sonnet 5.5 / Haiku 5.5),以結構化輸出(JSON schema)直接回傳各欄位,手寫、藝術字、反光、日韓文名片也較準。需在設定輸入自己的 Anthropic API 金鑰;金鑰只存在該裝置的瀏覽器,由瀏覽器直接呼叫 `api.anthropic.com`(官方 `@anthropic-ai/sdk`,`dangerouslyAllowBrowser`),送出的是裁切拉正後的名片。Opus / Sonnet 模型會開啟伺服器端備援(`fallbacks: "default"`),模型婉拒時自動改用備援模型;Claude 呼叫失敗(金鑰錯誤、額度、斷網)時自動改用本機辨識。建議為此建立專用金鑰並在 Anthropic Console 設定花費上限,共用電腦請勿儲存金鑰。
- **快速索引**:
  - 搜尋框即時搜尋(按 `/` 聚焦,方向鍵選擇、Enter 開啟):記憶體內倒排索引,中文以單字 / 雙字索引、英文以字首索引、電話以所有 3 碼以上的數字片段索引,所以「大明」「積體」「thin」、電話末四碼「5678」都能找到;結果依命中欄位加權排序(姓名 > 公司 > 標籤 > Email / 電話 > 職稱 …),命中處以螢光標示,也會露出命中的地址、備註等欄位。
  - 進階語法:`公司:鑫科`、`company:acme`、`#客戶`(標籤)、`電話:5678`、`職稱:經理`、`-離職`(排除)、`"sales manager"`(片語);多個條件以空白分隔表示同時符合。
  - 分組瀏覽:依姓名首字(英文依字母,中文依筆畫)、公司、標籤、建檔月份分組,右側索引列可點選或上下拖曳快速跳到該組;標籤、星號、待確認可疊加篩選。
- **重複偵測**:新增時若 Email、手機或「姓名 + 公司」與既有名片相同,會詢問是否合併(新資料覆蓋、電話與 Email 累加、舊職稱 / 舊公司記入備註)。
- **轉檔**:匯出 Excel 可開的 CSV(UTF-8 BOM)、vCard(.vcf,可匯入手機通訊錄 / Outlook / Google 聯絡人)、完整備份 JSON(含名片照片);可匯入 JSON 備份、CSV(本程式或 Outlook / Google 匯出的欄位名稱)與 vCard。有搜尋或篩選時只匯出目前的結果。單張名片可下載 vCard,並有撥號、寄信、地圖、網站捷徑。

## MiniCPM-OCR 伺服器

模型無法在瀏覽器裡執行,需要一台電腦跑辨識伺服器(以下摘自[官方部署文件](https://github.com/OpenBMB/MiniCPM-OCR/tree/main/docs),埠號沿用官方的 18499):

1. **下載模型**(Hugging Face `openbmb/MiniCPM-OCR-1.0-gguf`):`MiniCPM-OCR-1_0-Q8_0.gguf`(約 0.8 GB)與視覺投影檔 `mmproj-model-f16-4x.gguf`(約 0.9 GB,讀圖必需)。另有 Q4/Q5/Q6 等較小的量化版本可選。
2. **啟動伺服器**,擇一:
   - **llama.cpp**(官方驗證版本 `b11901`,可純 CPU):
     ```bash
     llama-server --model MiniCPM-OCR-1_0-Q8_0.gguf --mmproj mmproj-model-f16-4x.gguf \
       --ctx-size 8192 --parallel 1 --host 127.0.0.1 --port 18499 --alias minicpm-ocr --jinja --reasoning off
     ```
     有 NVIDIA GPU 時加 `--n-gpu-layers 99`(編譯時加 `-DGGML_CUDA=ON`);純 CPU 加 `--n-gpu-layers 0 --no-mmproj-offload`。官方另有 DSpark 推測解碼的草稿模型可加速,參數見官方文件。
   - **Ollama**(v0.40.12 以上):依官方 `ollama_deploy.md` 用 Modelfile 建立名為 `minicpm-ocr` 的本機模型,`OLLAMA_HOST=127.0.0.1:18499 ollama serve`。
   - **vLLM**(NVIDIA GPU):`vllm serve openbmb/MiniCPM-OCR-1.0 --served-model-name minicpm-ocr --port 18499 --trust-request-mm-kwargs --default-chat-template-kwargs '{"enable_thinking":false}'`(完整參數見官方 `vllm_deploy_en.md`);也有官方 Docker 映像 `openbmbofficial/minicpm-ocr`。
3. **連接名片庫**,擇一:
   - **建議:同源代理**。`python -m card_scanner serve --ocr-backend http://127.0.0.1:18499`,開 http://127.0.0.1:8780/ ,App 會自動偵測並改用 MiniCPM-OCR(設定裡的伺服器網址為 `/minicpm`)。瀏覽器不必處理跨來源,後端需要金鑰時用 `--ocr-api-key`,金鑰只留在伺服器。加 `--host 0.0.0.0` 讓同網段的手機也能用電腦上的模型(此時區網內任何人都能使用這個辨識伺服器;手機在 http 網址下無法開相機取景,改用「從相簿選照片」或手機內建相機拍照)。
   - **直接連線**:在 GitHub Pages 版的設定填 `http://127.0.0.1:18499`,按「測試連線」。伺服器必須允許跨來源請求(Ollama 設 `OLLAMA_ORIGINS=https://<帳號>.github.io`;vLLM 用 `--allowed-origins`);從 https 網頁連 http://127.0.0.1 在 Chrome / Edge 可行(可能會先詢問是否允許存取區域網路),Safari 會擋。測試連線失敗時改用上面的同源代理。
4. **量測效果**:`tools/ocr-bench` 可用同一組 24 張測試圖比較本機 Tesseract 與 MiniCPM-OCR:`ENGINE=minicpm MC_SERVER=http://127.0.0.1:18499 node bench.cjs`(加 `MC_MODE=kie` 測欄位擷取模式)。

注意:官方文件標示支援中文與英文,沒有特別說明繁體中文;MiniCPM-OCR 本身不判斷照片方向:結果的主要欄位少於 2 個時,App 會自動改試 180°/90°/270° 再送一次(多花一到三次辨識時間),也可用編輯畫面的「旋轉」後按「重新辨識」。

## 使用提示

第一次開啟可在空白頁按「載入示範名片」看看效果(8 張虛構名片,可在設定中清除)。手機上可用瀏覽器的「加入主畫面」當成 App 使用。

## 注意事項

- 資料存在瀏覽器裡:換裝置、換瀏覽器看不到,清除瀏覽資料會一併刪除。請定期「⋯ → 完整備份」,並可在設定按「要求永久保存」降低瀏覽器自動清理的機會。名片含個人資料,備份檔請妥善保管,不要 commit 到 repo(repo 與網站都是公開的)。
- 本機 OCR 的準確度取決於照片:用相機取景框讓名片占滿框、對焦清楚效果最好;辨識結果一定要人工核對。以合成名片的基準測試,欄位正確率從 37% 提升到約 80%(轉 90° / 倒置 / 傾斜的照片從幾乎 0 到與正放相近);又小又模糊的照片仍然很差。測試方法與數據見 `tools/ocr-bench/`。
- 第一次使用本機 OCR 或 Claude 需要能連到 cdn.jsdelivr.net(以及 Claude 的 api.anthropic.com)。
- 名片備份檔含個人資料,`.gitignore` 已排除預設的匯出檔名,請勿 commit。
- 測試:`pip install -r requirements-dev.txt && pytest`(含 `tests/js/card_scanner.test.cjs` 的解析、搜尋、影像處理單元測試,需要 Node.js);push 到 `main` 時 GitHub Actions 會先測試再發布。辨識率基準測試見 `tools/ocr-bench/README.md`。
