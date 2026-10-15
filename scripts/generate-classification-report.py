#!/usr/bin/env python3
"""星學匯微信公眾號文章內容分類報告生成器。

從 content/events 的文章 markdown（微信公眾號後台同步數據）讀取全部推文，
按關鍵詞規則 + 人工覆蓋庫分類，為每篇文章提取一張配圖（git 歷史 PDF 或線上文章頁），
生成帶發佈日期的分類報告 docx、分類審核表 xlsx 與配圖清單 csv。

用法:
    python scripts/generate-classification-report.py              # 全流程
    python scripts/generate-classification-report.py --skip-images # 只分類+報告
    python scripts/generate-classification-report.py --audit      # 只分類+審核表（校對用）
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_DIR = SCRIPT_DIR.parent
EVENTS_DIR = REPO_DIR / "content" / "events"
CONFIG_DIR = SCRIPT_DIR / "report-config"
DEFAULT_OUTPUT_DIR = REPO_DIR.parent / "分類報告"
DEFAULT_PDF_COMMIT = "9f6d77be"  # static/wechat_pdfs 峰值提交（552 份 PDF）

CATEGORY_ORDER_FALLBACK_LAST = ("Q",)


# ---------------------------------------------------------------- 事件讀取

def parse_front_matter(text: str) -> dict:
    m = re.match(r"^\+\+\+\r?\n(.*?)\r?\n\+\+\+", text, re.DOTALL)
    if not m:
        return {}
    fm = {}
    for line in m.group(1).splitlines():
        km = re.match(r"^([A-Za-z_]+)\s*=\s*(.*)$", line.strip())
        if km:
            key, raw = km.group(1), km.group(2).strip()
            if len(raw) >= 2 and raw[0] in "'\"" and raw[-1] == raw[0]:
                raw = raw[1:-1]
            fm[key] = raw
    return fm


def parse_date(raw: str) -> dt.date | None:
    if not raw:
        return None
    raw = raw.strip().strip("'\"")
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", raw)
    if m:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def load_events() -> list[dict]:
    articles = []
    for md in sorted(EVENTS_DIR.glob("*.md")):
        if md.name == "_index.md":
            continue
        fm = parse_front_matter(md.read_text(encoding="utf-8"))
        if not fm.get("title"):
            continue
        articles.append(
            {
                "file": md.name,
                "title": fm.get("title", "").strip(),
                "date": parse_date(fm.get("date", "")),
                "date_raw": fm.get("date", ""),
                "article_id": fm.get("article_id", ""),
                "source_link": fm.get("source_link", ""),
                "pdf_file": fm.get("pdf_file", ""),
                "cat": None,
                "basis": "",
                "matched": "",
                "image": "",
                "image_source": "",
            }
        )
    articles.sort(key=lambda a: (a["date"] or dt.date(1970, 1, 1), a["title"]))
    return articles


# ---------------------------------------------------------------- 分類

def compile_rules(config: dict) -> list[dict]:
    rules = []
    for rule in config["rules"]:
        rules.append(
            {
                "id": rule["id"],
                "cat": rule["cat"],
                "desc": rule.get("desc", ""),
                "include": [re.compile(p) for p in rule.get("patterns", [])],
                "exclude": [re.compile(p) for p in rule.get("exclude", [])],
            }
        )
    return rules


def classify(articles: list[dict], rules: list[dict], overrides: dict, categories: dict) -> None:
    for a in articles:
        ov = overrides.get(a["file"])
        if ov:
            a["cat"], a["basis"], a["matched"] = ov["cat"], "人工覆蓋", ov.get("note", "")
            continue
        for rule in rules:
            if any(e.search(a["title"]) for e in rule["exclude"]):
                continue
            hit = next((p.pattern for p in rule["include"] if p.search(a["title"])), None)
            if hit:
                a["cat"], a["basis"], a["matched"] = rule["cat"], f"規則 {rule['id']}", hit
                break
        if not a["cat"]:
            a["cat"], a["basis"], a["matched"] = "Q", "未匹配", ""


# ---------------------------------------------------------------- 配圖：git 歷史 PDF

def norm_name(name: str) -> str:
    """全半角歸一化，用於 md 的 pdf_file 與 git 內文件名的模糊對應。"""
    s = unicodedata.normalize("NFKC", name)
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"[．。·・_\-—–()（）]+", "", s)
    return s.lower()


def build_pdf_index(commit: str) -> tuple[dict, dict]:
    out = subprocess.run(
        ["git", "-c", "core.quotepath=false", "-C", str(REPO_DIR), "ls-tree", "-r", commit, "static/wechat_pdfs"],
        capture_output=True, check=True,
    ).stdout.decode("utf-8")
    exact: dict[str, str] = {}
    norm: dict[str, str] = {}
    for line in out.splitlines():
        parts = line.split("\t", 1)
        if len(parts) != 2:
            continue
        meta, path = parts
        blob = meta.split()[2]
        name = Path(path).name
        exact[name] = blob
        norm.setdefault(norm_name(name), blob)
    return exact, norm


def read_blob(blob: str) -> bytes:
    return subprocess.run(
        ["git", "-C", str(REPO_DIR), "cat-file", "blob", blob],
        capture_output=True, check=True,
    ).stdout


def pick_pdf_image(pdf_bytes: bytes, max_width: int = 900) -> bytes | None:
    """從文章 PDF 中選一張最有代表性的圖（優先前 4 頁中面積最大者，跳過二維碼/小圖）。"""
    try:
        import pymupdf as fitz  # PyMuPDF
    except ImportError:
        import fitz  # PyMuPDF（舊版）
    from PIL import Image

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return None
    best = None  # (area, xref)
    for pno in range(min(4, len(doc))):
        try:
            images = doc.get_page_images(pno, full=True)
        except Exception:
            continue
        for img in images:
            xref, w, h = img[0], img[2], img[3]
            if w < 300 or h < 200:
                continue
            # 跳過近似正方形的中低分辨率圖（多為二維碼/logo）
            if 0.8 < w / h < 1.25 and w < 900 and h < 900:
                continue
            area = w * h
            if best is None or area > best[0]:
                best = (area, xref)
    raw = None
    if best:
        try:
            info = doc.extract_image(best[1])
            raw = info["image"]
        except Exception:
            raw = None
    if raw is None:
        # 沒有合適內嵌圖時渲染首頁
        try:
            pix = doc[0].get_pixmap(matrix=fitz.Matrix(1.5, 1.5))
            raw = pix.tobytes("png")
        except Exception:
            return None
    try:
        im = Image.open(io.BytesIO(raw))
        im = im.convert("RGB")
        if im.width > max_width:
            im = im.resize((max_width, round(im.height * max_width / im.width)))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=85)
        return buf.getvalue()
    except Exception:
        return None


# ---------------------------------------------------------------- 配圖：線上文章頁

UA_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
    "Accept-Language": "zh-HK,zh;q=0.9,en;q=0.8",
}


def fetch_online_image(url: str, session) -> bytes | None:
    from PIL import Image

    try:
        r = session.get(url, headers=UA_HEADERS, timeout=25)
        if r.status_code != 200:
            return None
        html = r.text
    except Exception:
        return None
    candidates = re.findall(r'property="og:image"\s+content="([^"]+)"', html)
    candidates += re.findall(r'content="([^"]+)"\s+property="og:image"', html)
    candidates += re.findall(r'var\s+msg_cdn_url\s*=\s*"(http[^"]+)"', html)
    candidates += [u for u in re.findall(r'data-src="(http[^"]+)"', html) if "mmbiz" in u]
    for cand in candidates[:6]:
        cand = cand.replace("&amp;", "&")
        try:
            ir = session.get(cand, headers={**UA_HEADERS, "Referer": "https://mp.weixin.qq.com/"}, timeout=25)
            if ir.status_code != 200 or len(ir.content) < 5000:
                continue
            im = Image.open(io.BytesIO(ir.content)).convert("RGB")
            if im.width < 200:
                continue
            if im.width > 900:
                im = im.resize((900, round(im.height * 900 / im.width)))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=85)
            return buf.getvalue()
        except Exception:
            continue
    return None


# ---------------------------------------------------------------- 輸出文件名

def safe_filename(title: str) -> str:
    s = re.sub(r'[\\/:*?"<>|｜︳|]', " ", title)
    s = re.sub(r"\s+", " ", s).strip(" .~")
    s = s[:70].strip()
    return s or "未命名"


def extract_images(articles: list[dict], categories: dict, out_dir: Path, commit: str,
                   online: bool = True) -> None:
    exact, norm = build_pdf_index(commit)
    img_root = out_dir / "配圖"
    img_root.mkdir(parents=True, exist_ok=True)
    import requests

    session = requests.Session()
    used: dict[str, int] = {}
    stats = {"pdf": 0, "online": 0, "none": 0}
    manifest_rows = []

    for i, a in enumerate(articles, 1):
        cat_name = categories[a["cat"]]["name"]
        cat_dir = img_root / cat_name
        base = safe_filename(a["title"])
        key = f"{cat_name}/{base}"
        data = None
        source = ""
        # 1) git 歷史 PDF
        if a["pdf_file"]:
            blob = exact.get(a["pdf_file"]) or norm.get(norm_name(a["pdf_file"]))
            if not blob:  # 再按歸一化標題碰一次
                blob = norm.get(norm_name(a["pdf_file"]))
            if blob:
                data = pick_pdf_image(read_blob(blob))
                if data:
                    source = f"git PDF（{a['pdf_file']}）"
                    stats["pdf"] += 1
        # 2) 線上文章頁
        if data is None and online and a["source_link"]:
            data = fetch_online_image(a["source_link"], session)
            if data:
                source = f"線上文章頁（{a['source_link']}）"
                stats["online"] += 1
                time.sleep(1.5)
        if data is None:
            stats["none"] += 1
            manifest_rows.append([a["date"], a["title"], a["file"], cat_name, "", "無配圖"])
            if i % 50 == 0:
                print(f"  配圖進度 {i}/{len(articles)} （PDF {stats['pdf']} / 線上 {stats['online']} / 無 {stats['none']}）")
            continue

        n = used.get(key, 0) + 1
        used[key] = n
        date_prefix = a["date"].isoformat() if a["date"] else "未知日期"
        fname = f"{date_prefix}_{base}" if n == 1 else f"{date_prefix}_{base}（{n}）"
        rel = f"配圖/{cat_name}/{fname}.jpg"
        cat_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / rel).write_bytes(data)
        a["image"], a["image_source"] = rel, source
        manifest_rows.append([a["date"], a["title"], a["file"], cat_name, f"{fname}.jpg", source])
        if i % 50 == 0:
            print(f"  配圖進度 {i}/{len(articles)} （PDF {stats['pdf']} / 線上 {stats['online']} / 無 {stats['none']}）")

    with (out_dir / "images_manifest.csv").open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["發佈日期", "文章標題", "來源文件", "分類", "配圖文件", "配圖來源"])
        w.writerows(manifest_rows)
    print(f"配圖完成：PDF {stats['pdf']}、線上 {stats['online']}、無 {stats['none']}")


# ---------------------------------------------------------------- 審核表

def write_audit_xlsx(articles: list[dict], categories: dict, out_dir: Path) -> None:
    import openpyxl
    from openpyxl.styles import Alignment, Font, PatternFill

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "分類審核表"
    headers = ["發佈日期", "文章標題", "分類", "分類依據", "命中關鍵詞/說明", "配圖文件", "來源文件"]
    ws.append(headers)
    hf = Font(bold=True, color="FFFFFF")
    fill = PatternFill("solid", fgColor="4472C4")
    for c in ws[1]:
        c.font, c.fill = hf, fill
    for a in articles:
        ws.append([
            a["date"].isoformat() if a["date"] else "",
            a["title"],
            categories[a["cat"]]["name"],
            a["basis"],
            a["matched"],
            a["image"],
            a["file"],
        ])
    widths = [12, 80, 22, 14, 30, 45, 60]
    for i, wd in enumerate(widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = wd
    for row in ws.iter_rows(min_row=2):
        row[1].alignment = Alignment(vertical="center")
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    wb.save(out_dir / "分類審核表.xlsx")


# ---------------------------------------------------------------- 報告 docx

def set_cjk(style_or_run, font: str = "微軟正黑體") -> None:
    from docx.oxml.ns import qn
    rPr = style_or_run._element.get_or_add_rPr() if hasattr(style_or_run, "_element") else None
    if rPr is None:
        return
    rFonts = rPr.get_or_add_rFonts()
    rFonts.set(qn("w:eastAsia"), font)


def write_docx(articles: list[dict], categories: dict, out_dir: Path, generated_on: dt.date) -> None:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn
    from docx.shared import Cm, Pt, RGBColor

    ACCENT = RGBColor(0x1F, 0x4E, 0x79)
    doc = Document()

    style = doc.styles["Normal"]
    style.font.name = "Microsoft JhengHei"
    style.font.size = Pt(10.5)
    style.element.rPr.rFonts.set(qn("w:eastAsia"), "微軟正黑體")

    dates = [a["date"] for a in articles if a["date"]]
    n = len(articles)

    title = doc.add_heading("星學匯微信公眾號文章內容分類報告（修訂版）", level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for text in (
        f"統計範圍：{n} 篇推文（{min(dates)} 至 {max(dates)}）",
        f"數據來源：公眾號後台同步資料　·　生成日期：{generated_on.isoformat()}",
    ):
        meta = doc.add_paragraph()
        meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = meta.add_run(text)
        r.font.size = Pt(8.5)
        r.font.color.rgb = RGBColor(0x80, 0x80, 0x80)

    # 一、分類總覽
    doc.add_heading("一、分類總覽", level=1)
    by_cat: dict[str, list[dict]] = {}
    for a in articles:
        by_cat.setdefault(a["cat"], []).append(a)
    order = [c for c in by_cat if c != "Q"]
    order.sort(key=lambda c: -len(by_cat[c]))
    if "Q" in by_cat:
        order.append("Q")

    table = doc.add_table(rows=1, cols=4)
    table.style = "Table Grid"
    for i, h in enumerate(["排名", "服務領域", "文章數量", "佔比"]):
        cell = table.rows[0].cells[i]
        cell.text = h
        for p in cell.paragraphs:
            for run in p.runs:
                run.font.bold = True
    for rank, cid in enumerate(order, 1):
        cnt = len(by_cat[cid])
        row = table.add_row().cells
        row[0].text = str(rank)
        row[1].text = categories[cid]["name"]
        row[2].text = f"{cnt} 篇"
        row[3].text = f"{cnt / n * 100:.1f}%"
    doc.add_paragraph()

    # 二、各分類概述
    doc.add_heading("二、各分類概述", level=1)
    for cid in order:
        items = by_cat[cid]
        span = f"{min(a['date'] for a in items if a['date'])} 至 {max(a['date'] for a in items if a['date'])}" if items else ""
        doc.add_heading(f"{categories[cid]['name']}（{len(items)} 篇）", level=2)
        p = doc.add_paragraph(f"{categories[cid]['desc']}。時間跨度：{span}。")

    # 三、修訂說明
    doc.add_heading("三、本版相對原報告的修訂說明", level=1)
    for line in [
        "每篇推文均標註公眾號發佈日期（早期文章為日期精度，2026 年 3 月後為後台同步的精確時間）。",
        "配圖以獨立文件存放於「配圖」資料夾，按分類歸檔、以活動（文章）名稱命名，未嵌入本文件；對照見 images_manifest.csv。",
        "分類體系微調：原「政府及機構招聘信息」併入「就業創業與招聘實習」；原「行業專業分享」與「座談會」合併為「講座、座談會與行業分享」；原「其他」拆分為「節日祝福與問候」「聲明與社會關懷」「組織信息與榮譽」「媒體報導與成員風采」「轉載與外部資訊」「生活福利與資歷資訊」等。",
        "修正原報告多處錯分（如「選民登記」誤入疫情服務、「火災聲明」誤入行業分享、「社團架構」誤入行業分享等）；分類依據見隨附《分類審核表.xlsx》，個別調整可於 overrides 文件中固化後重新生成。",
        "統計口徑為全部已同步推文，含同一文章的多次重發。",
    ]:
        doc.add_paragraph(line, style="List Bullet")

    # 四、分類明細
    from docx.oxml import OxmlElement

    def _tr_flag(row, tag: str) -> None:
        row._tr.get_or_add_trPr().append(OxmlElement(f"w:{tag}"))

    doc.add_heading("四、分類明細（各分類內按發佈時間排序）", level=1)
    for ci, cid in enumerate(order):
        items = sorted(by_cat[cid], key=lambda a: (a["date"] or dt.date(1970, 1, 1), a["title"]))
        doc.add_heading(f"{categories[cid]['name']}（{len(items)} 篇）", level=2)
        t = doc.add_table(rows=1, cols=4)
        t.style = "Table Grid"
        for i, h in enumerate(["#", "發佈日期", "文章標題", "配圖文件"]):
            cell = t.rows[0].cells[i]
            cell.text = h
            for p in cell.paragraphs:
                for run in p.runs:
                    run.font.bold = True
        _tr_flag(t.rows[0], "tblHeader")  # 跨頁重複表頭
        for idx, a in enumerate(items, 1):
            row = t.add_row().cells
            row[0].text = str(idx)
            row[1].text = a["date"].isoformat() if a["date"] else "—"
            row[2].text = a["title"]
            row[3].text = Path(a["image"]).stem if a["image"] else "—"
            for cell in row:
                for p in cell.paragraphs:
                    for run in p.runs:
                        run.font.size = Pt(9)
        # 固定列寬（合計 ≤ A4 可用寬度，避免日期列被擠到換行）+ 行不跨頁拆分
        layout = OxmlElement("w:tblLayout")
        layout.set(qn("w:type"), "fixed")
        t._tbl.tblPr.append(layout)
        for row in t.rows:
            _tr_flag(row, "cantSplit")
            row.cells[0].width = Cm(1.0)
            row.cells[1].width = Cm(2.5)
            row.cells[2].width = Cm(8.5)
            row.cells[3].width = Cm(3.8)
        if ci < len(order) - 1:  # 末表後不留空段落，避免多出空白尾頁
            doc.add_paragraph()

    out = out_dir / "星學匯文章內容分類報告_v2.docx"
    doc.save(out)
    print(f"報告已生成：{out}")


# ---------------------------------------------------------------- 主流程

def main() -> None:
    ap = argparse.ArgumentParser(description="星學匯公眾號文章分類報告生成器")
    ap.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    ap.add_argument("--pdf-commit", default=DEFAULT_PDF_COMMIT)
    ap.add_argument("--skip-images", action="store_true", help="跳過配圖提取")
    ap.add_argument("--no-online", action="store_true", help="不抓線上文章頁配圖")
    ap.add_argument("--audit", action="store_true", help="只輸出分類審核表（校對用）")
    args = ap.parse_args()

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    config = json.loads((CONFIG_DIR / "classification-rules.json").read_text(encoding="utf-8"))
    overrides = json.loads((CONFIG_DIR / "classification-overrides.json").read_text(encoding="utf-8"))
    overrides = {k: v for k, v in overrides.items() if not k.startswith("_")}
    categories = config["categories"]
    rules = compile_rules(config)

    print("讀取文章…")
    articles = load_events()
    print(f"共 {len(articles)} 篇")
    classify(articles, rules, overrides, categories)

    # 概覽
    counts: dict[str, int] = {}
    for a in articles:
        counts[a["cat"]] = counts.get(a["cat"], 0) + 1
    for cid in sorted(counts, key=lambda c: -counts[c]):
        print(f"  {cid} {categories[cid]['name']}: {counts[cid]}")

    write_audit_xlsx(articles, categories, out_dir)
    print(f"審核表已生成：{out_dir / '分類審核表.xlsx'}")

    if args.audit:
        return

    if not args.skip_images:
        print("提取配圖…")
        extract_images(articles, categories, out_dir, args.pdf_commit, online=not args.no_online)
    else:
        # 從既有 manifest 恢復配圖檔名，保證 --skip-images 重跑時報告配圖列不缺
        mf = out_dir / "images_manifest.csv"
        if mf.exists():
            with mf.open(encoding="utf-8-sig") as f:
                by_file = {row["來源文件"]: row for row in csv.DictReader(f)}
            hit = 0
            for a in articles:
                row = by_file.get(a["file"])
                if row and row["配圖文件"]:
                    a["image"] = f"配圖/{row['分類']}/{row['配圖文件']}"
                    hit += 1
            print(f"跳過配圖提取，已從 manifest 恢復 {hit} 篇配圖信息")

    write_docx(articles, categories, out_dir, dt.date.today())


if __name__ == "__main__":
    main()
