# 星學匯 Starian 官方網站

> 星學匯內地港生升學就業交流中心的官方網站 —— 用 Hugo 建置的靜態網站，並附帶微信公眾號文章自動同步工具鏈。

- 正式網址：<https://www.starian.org.hk/>
- 托管倉庫：<https://github.com/StarianHK/StarianHK.github.io>

---

## 目錄

- [專案簡介](#專案簡介)
- [技術架構](#技術架構)
- [目錄結構](#目錄結構)
- [環境需求](#環境需求)
- [快速開始](#快速開始)
- [常用指令](#常用指令)
- [建置與部署](#建置與部署)
- [內容管理](#內容管理)
- [微信公眾號文章同步](#微信公眾號文章同步)
- [分類報告工具](#分類報告工具)
- [佈景主題](#佈景主題)
- [樣式與設計](#樣式與設計)
- [常見問題](#常見問題)

---

## 專案簡介

本專案是星學匯（Starian）協會的官方網站。星學匯自 2013 年成立，圍繞「升學、就業、交流」三個方向服務內地港生與香港青年。

網站主要承載四類內容：

1. **機構概況** —— 願景、使命、組織架構與服務範圍（`/about/`）
2. **近期活動** —— 由微信公眾號同步而來的活動與資訊推文（`/events/`）
3. **活動相冊** —— 按月份整理的活動照片（`/gallery/`）
4. **加入我們** —— 會員登記與聯絡方式（`/contact/`）

網站使用 Hugo 產生純靜態 HTML，透過 GitHub Actions 自動部署到 GitHub Pages，亦可部署至 Cloudflare Pages。

---

## 技術架構

| 項目 | 技術 |
| --- | --- |
| 靜態網站產生器 | [Hugo](https://gohugo.io/)（extended，CI 使用 `0.152.2`，最低 `0.80.0`） |
| 佈景主題 | [`hugo-saasify-theme`](https://github.com/chaoming/hugo-saasify-theme)（git submodule） |
| 樣式 | [Tailwind CSS 3](https://tailwindcss.com/) + PostCSS + Autoprefixer |
| 內容格式 | Markdown + TOML / YAML front matter |
| 主要語言 | 繁體中文（`zh-tw`） |
| 同步工具 | Node.js + [Playwright](https://playwright.dev/)（微信公眾號後台抓取） |
| 報表工具 | Python 3（文章分類報告） |
| CI/CD | GitHub Actions → GitHub Pages；選用 Cloudflare Pages（Wrangler） |

---

## 目錄結構

```
.
├── archetypes/              # Hugo 新內容範本
├── assets/css/              # Tailwind 來源 (main.css) 與產出 (generated.css)
├── content/                 # 網站內容（Markdown）
│   ├── _index.md            # 首頁（含 hero / 重點區塊）
│   ├── about/_index.md      # 機構概況
│   ├── contact/_index.md    # 加入我們
│   ├── events/              # 近期活動（微信同步，1400+ 篇）
│   │   └── _index.md
│   ├── gallery/_index.md    # 活動相冊
│   ├── zh-cn/               # 多語言示範內容（目前未啟用）
│   ├── careers.md           # 佈景主題範例頁（多為未使用）
│   ├── company.md
│   ├── license.md
│   ├── pricing.md
│   └── privacy.md           # 隱私政策（頁尾有連結）
├── layouts/                 # 覆寫佈景主題的版面
│   ├── _default/
│   │   ├── baseof.html      # 全站基底模板
│   │   └── simple.html      # 內頁（about / contact / privacy）模板
│   ├── events/              # 活動列表與單頁
│   ├── gallery/list.html    # 讀取 static/images/gallery 產生相冊
│   ├── shortcodes/
│   │   └── latest-event.html
│   └── partials/            # header / footer / custom-head 等
├── scripts/
│   ├── build-deploy.mjs           # Tailwind 建置 + Hugo 建置
│   ├── sync-wechat-events.mjs     # 微信公眾號文章同步
│   ├── generate-classification-report.py  # 文章分類報表
│   └── report-config/             # 分類規則、覆蓋庫、標題匯出
├── static/
│   ├── images/              # 圖片資源
│   │   ├── gallery/<YYYY-MM>/     # 相冊照片（依月份資料夾）
│   │   ├── blog/ company/ logos/ social/
│   ├── css/                 # 靜態樣式
│   └── wechat_pdfs/         # 舊活動 PDF（S42-1.pdf / S42-2.pdf）
├── themes/
│   └── hugo-saasify-theme/  # 佈景主題（git submodule）
├── .github/workflows/pages.yml    # GitHub Pages 部署流程
├── hugo.toml                # Hugo 主要設定（含選單、參數）
├── package.json             # npm 腳本與相依
├── tailwind.config.js       # Tailwind 設定（preset 來自主題）
├── postcss.config.js        # PostCSS 設定
├── wrangler.jsonc           # Cloudflare Pages 設定
├── CNAME                    # 自訂網域：www.starian.org.hk
├── sync-wechat-events.cmd   # Windows 一鍵同步批次檔
└── git.sh                   # 互動式 commit & push 腳本
```

---

## 環境需求

- **Node.js** 20 或以上（CI 使用 Node 20；本機建議 LTS）
- **Hugo Extended** `0.80.0` 以上（本專案透過 `hugo-bin` npm 套件安裝，無需全域安裝）
- **Python 3**（僅分類報表工具需要）
- 首次使用微信同步需安裝 Playwright 瀏覽器與 Edge / Chrome

```powershell
npm install
```

`npm install` 會透過 `hugo-bin` 一併下載對應平台的 Hugo 執行檔。

---

## 快速開始

```powershell
# 1. 安裝相依（含 Hugo 與 Playwright）
npm install

# 2. 啟動開發伺服器（Tailwind watch + hugo server -D）
npm start
```

`npm start` 會同時：
- 監看 `assets/css/main.css`，即時產生 `assets/css/generated.css`
- 啟動 `hugo server -D`，預設於 <http://localhost:1313/>

---

## 常用指令

| 指令 | 說明 |
| --- | --- |
| `npm start` | 開發模式：Tailwind watch + Hugo 即時預覽 |
| `npm run build` | 正式建置（先編譯壓縮 CSS，再 `hugo --gc --minify`） |
| `npm run build:css` | 只重新編譯並壓縮 Tailwind CSS |
| `npm run build:with-pdfs` | 編譯 CSS 後建置（保留舊版相容指令） |
| `npm run sync:wechat` | 同步微信文章（不推送） |
| `npm run sync:wechat:push` | 同步微信文章並 commit + push |
| `npm run deploy:cloudflare` | 建置並部署到 Cloudflare Pages |

> 注意：修改 `content/**` 中的 HTML 類別或新增樣式後，務必確保 `generated.css` 已重新編譯，否則正式站樣式不會更新。

---

## 建置與部署

### GitHub Pages（主要）

`.github/workflows/pages.yml` 會在 `main` 分支推送時自動：

1. Checkout（含 submodule）
2. 安裝 Node 20 與相依（`npm ci`）
3. 安裝 Hugo Extended `0.152.2`
4. 執行 `npm run build`
5. 上傳 `public/` 並部署至 GitHub Pages

網域由 `CNAME`（`www.starian.org.hk`）指定。

### Cloudflare Pages（選用）

```powershell
npm run deploy:cloudflare
```

會先 `npm run build`，再以 `wrangler pages deploy public --project-name website` 發佈（設定見 `wrangler.jsonc`）。

---

## 內容管理

### 首頁

`content/_index.md` 直接以 HTML 撰寫 hero 與「協會重點」區塊，搭配自訂樣式類別（`star-*`）。

### 機構概況 / 加入我們

- `content/about/_index.md`
- `content/contact/_index.md`

兩者 front matter 使用 `layout = "simple"`，由 `layouts/_default/simple.html` 渲染，正文可直接寫 HTML。

### 相冊

`layouts/gallery/list.html` 會掃描 `static/images/gallery/` 下符合 `YYYY-MM` 命名的資料夾，自動：

- 依月份分組（新到舊）
- 產生年份時間軸側欄
- 支援 `.jpg / .jpeg / .png / .webp / .gif / .avif`

新增相冊只需在 `static/images/gallery/` 建立如 `2026-08/` 的資料夾並放入照片。

### 活動（Events）

活動內容位於 `content/events/`，每篇文章的 front matter 大致如下：

```toml
+++
date = '2026-03-03T10:35:17+08:00'
draft = false
title = '元宵節快樂'
article_id = 'ezg77PsWM5-Hbp5kzsSH9Q'
source_link = 'https://mp.weixin.qq.com/s/ezg77PsWM5-Hbp5kzsSH9Q'
+++
```

- 若存在 `source_link`，活動單頁與列表會**直接跳轉**到原微信文章（見 `layouts/partials/event-target-url.html`）。
- 若無 `source_link` 但有 `article_id`，會組成 `https://mp.weixin.qq.com/s/<article_id>`。
- 舊活動可透過 `pdf_file` 指定 `static/wechat_pdfs/` 中的 PDF（目前支援 `S42-1.pdf`、`S42-2.pdf`），頁面會內嵌預覽。

活動列表採分頁（每頁 9 篇，見 `hugo.toml` 的 `paginate`）。

---

## 微信公眾號文章同步

`scripts/sync-wechat-events.mjs` 會登入微信公眾號後台，抓取「星學匯Starian」帳號已發佈文章，為尚未同步的文章在 `content/events/` 產生 Markdown 存根，最後建置（並可選擇 commit + push）。

### Windows 一鍵同步

雙擊 `sync-wechat-events.cmd`：會自動安裝相依、Hugo，再執行同步並推送。

### 手動執行

```powershell
# 同步但不推送
npm run sync:wechat

# 同步並 commit + push
npm run sync:wechat -- --push

# 只預覽（不 commit / push）
npm run sync:wechat -- --push --dry-run
```

執行時會開啟瀏覽器（預設 Edge），掃碼登入後自動讀取文章清單。首次登入 session 會快取在 `.cache/wechat-session/`。

### 常用參數

| 參數 | 說明 |
| --- | --- |
| `--push` | 同步後自動 commit 並 push |
| `--dry-run` | 預覽建置與 git 操作，不實際提交 |
| `--no-build` | 跳過 Hugo 建置 |
| `--headless` / `--headed` | 瀏覽器無頭 / 可見 |
| `--article-url <url>` | 直接匯入指定文章 |
| `--browser-channel <channel>` | Playwright 瀏覽器通道（預設 `msedge`） |
| `--wait-timeout-ms <ms>` | 等待掃碼登入的逾時時間 |

可用環境變數覆寫目標帳號：`WECHAT_TARGET_NICKNAME`、`WECHAT_TARGET_USER_NAME`、`WECHAT_TARGET_BIZ`。

> 產生的 Markdown 存根只含 front matter 與 `source_link`，正文交由前端跳轉至原文章，避免版權與內容重複問題。

---

## 分類報告工具

`scripts/generate-classification-report.py` 讀取 `content/events/` 全部文章，依「關鍵詞規則 + 人工覆蓋庫」分類，並為每篇擷取一張配圖，輸出 Word 報告、Excel 審核表與 CSV 配圖清單。

```powershell
python scripts/generate-classification-report.py            # 全流程
python scripts/generate-classification-report.py --skip-images  # 只分類 + 報告
python scripts/generate-classification-report.py --audit        # 只分類 + 審核表
```

規則與覆蓋設定位於 `scripts/report-config/`：

- `classification-rules.json` —— 關鍵詞規則
- `classification-overrides.json` —— 人工覆蓋
- `titles_dump.*` —— 標題匯出（校對用）

---

## 佈景主題

本專案以 `hugo-saasify-theme` 為基礎，透過 `layouts/` 覆寫客製版面。主題以 git submodule 管理：

```powershell
# 首次 clone 請一併抓取子模組
git clone --recurse-submodules <repo-url>

# 既有倉庫補抓子模組
git submodule update --init --recursive
```

`hugo.toml` 已啟用 `enableGitInfo`，選單（主選單與頁尾欄位）亦在此設定。

---

## 樣式與設計

- Tailwind 來源檔：`assets/css/main.css`（含 `star-*`、`event-*`、`gallery-*` 等自訂樣式層）
- 產出檔：`assets/css/generated.css`（**請勿手改，由 Tailwind 產生**）
- `tailwind.config.js` 繼承主題 preset，並自訂主色（藍 `primary`）、輔色（橙 `secondary`）與字型
- `custom-head.html` 額外載入 Noto Sans/Serif TC 與 Font Awesome

變更樣式後請執行 `npm run build:css`（或保持 `npm start` 的 watch）以更新 `generated.css`。

---

## 常見問題

**Q：`npm start` 後樣式沒更新？**
確認 Tailwind watch 有在執行，或手動跑一次 `npm run build:css`。

**Q：建置時找不到 Hugo？**
`npm install` 會透過 `hugo-bin` 安裝。若仍失敗，可嘗試 `node node_modules/hugo-bin/lib/install.js`。

**Q：微信同步被限制（頻率控制）？**
同步腳本已優先走後台 API、必要時改用瀏覽器 UI 讀取，並加入隨機延遲。若仍受限，請降低同步頻率或稍後再試。

**Q：活動頁為何是空白或只有跳轉？**
活動多為微信文章存根，頁面會導向原始微信連結；此為預期行為。

---

## 授權

網站內容歸星學匯所有。佈景主題 `hugo-saasify-theme` 依其自身授權（MIT）提供。
