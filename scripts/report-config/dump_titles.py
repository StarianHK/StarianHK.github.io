"""Dump all article titles + dates from content/events for classification review."""
import json
import re
import sys
from pathlib import Path

EVENTS_DIR = Path(r"C:\Users\Administrator\Desktop\starian\starian.github.io\content\events")


def parse_front_matter(text: str) -> dict:
    m = re.match(r"^\+\+\+\r?\n(.*?)\r?\n\+\+\+", text, re.DOTALL)
    if not m:
        return {}
    fm = {}
    for line in m.group(1).splitlines():
        km = re.match(r"^([A-Za-z_]+)\s*=\s*(.*)$", line.strip())
        if km:
            key, raw = km.group(1), km.group(2).strip()
            if raw.startswith(("'", '"')) and raw.endswith(("'", '"')) and len(raw) >= 2:
                raw = raw[1:-1]
            fm[key] = raw
    return fm


def main() -> None:
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
                "date": fm.get("date", ""),
                "title": fm.get("title", ""),
                "article_id": fm.get("article_id", ""),
                "source_link": fm.get("source_link", ""),
                "pdf_file": fm.get("pdf_file", ""),
            }
        )
    out = Path(r"C:\Users\Administrator\Desktop\starian\starian.github.io\scripts\report-config\titles_dump.json")
    out.write_text(json.dumps(articles, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(articles)} articles -> {out}")
    # Quick TSV for eyeballing
    tsv = out.with_suffix(".tsv")
    with tsv.open("w", encoding="utf-8") as f:
        for a in sorted(articles, key=lambda x: x["date"]):
            f.write(f"{a['date'][:10]}\t{a['title']}\t{a['file']}\n")
    print(f"tsv -> {tsv}")


if __name__ == "__main__":
    main()
