# 檔案轉檔工具 File Converter

純前端的 PDF → TXT、XLSX → CSV 轉檔工具。所有轉檔在瀏覽器本地執行，**檔案絕對不上傳任何伺服器**。

## 功能

### 📄 PDF → TXT
將座位表 PDF 轉成純文字檔，供管理職類查詢系統調閱。
取代原本「用 Google 文件開啟 → 另存 TXT」的手動流程。

### 📊 XLSX → CSV
將報檢資料 XLSX 轉成 CSV，並**自動過濾個資**（電話、MAIL、地址、生日等）：
- 術科報檢資料（含 SKT1 sheet）→ `報檢資料.csv`（8 欄位）
- 檔名含「學科報檢資料」→ `學科報檢資料.csv`（7 欄位）

## 使用方式

### 線上使用（GitHub Pages）
直接訪問 https://<你的帳號>.github.io/file-converter/

### 本地使用
```bash
# 開啟 index.html 即可
open index.html
# 或啟動本地伺服器
python3 -m http.server 8000
# 然後開 http://localhost:8000
```

## 技術細節

- **PDF.js** 4.0.379 — 純 JS PDF 文字抽取
- **SheetJS** 0.20.1 — 純 JS XLSX 處理
- 兩者皆透過 CDN 載入，無需安裝任何依賴
- 純前端，無後端，無追蹤，無 cookie
- 離線也可用（若瀏覽器已快取 CDN lib）

## 部署到 GitHub Pages

1. 推到 GitHub repo
2. Repo Settings → Pages → Source 選「Deploy from branch: main / root」
3. 幾分鐘後即可透過 `https://<帳號>.github.io/file-converter/` 訪問

## 隱私

- ✅ 所有轉檔在瀏覽器本地 JS 執行
- ✅ 無後端、無追蹤、無上傳
- ✅ 關閉分頁後資料消失
- ✅ 原始碼公開，可自行稽核

## 授權

MIT License
