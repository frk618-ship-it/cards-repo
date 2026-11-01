# 辨識率基準測試

用 4 張合成名片 × 6 種拍攝狀況(乾淨、放在桌上傾斜 5°、陰影與低對比、轉 90°、小又模糊、倒置再傾斜)跑 App 實際的前處理 + Tesseract 流程,計算欄位(姓名、公司、職稱、電話、Email、地址)正確率。調整 `imaging.js` / `ocr.js` / `parser.js` 後用來比較前後差異。

```bash
cd tools/ocr-bench
npm i playwright tesseract.js@7.0.0 @tesseract.js-data/chi_tra@1.0.0   # 需要 Chromium 與 CJK 字型(例如 fonts-wqy-zenhei)
npx playwright install chromium                                       # 已有 Chromium 可略過
python -m card_scanner build                                          # 在 repo 根目錄先產生 dist/index.html
node bench.cjs                     # 全部 24 組;node bench.cjs '' B 只跑名片 B
```

引擎與語言檔從本機 `node_modules` 提供(攔截 jsdelivr 請求),不需要連網。合成圖與未命中欄位寫在 `out/`。

2026-11 的結果(chi_tra):

| 版本 | 乾淨 | 桌面傾斜 | 陰影低對比 | 轉 90° | 小又模糊 | 倒置傾斜 | 合計 |
|---|---|---|---|---|---|---|---|
| 只有對比拉伸 | 24/26 | 12/26 | 21/26 | 0/26 | 1/26 | 0/26 | 37.2% |
| 自動裁切、拉正、方向判斷、去陰影/反相、多次辨識互補、錯字修正 | 25/26 | 22–24/26 | 21–22/26 | 25/26 | 6–9/26 | 23–24/26 | 約 80% |

合成圖不等於真實照片,數字只用來比較版本之間的差異。
