"""按分類傾印分類結果供人工審閱。"""
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("g", HERE.parent / "generate-classification-report.py")
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

config = json.loads((g.CONFIG_DIR / "classification-rules.json").read_text(encoding="utf-8"))
overrides = {k: v for k, v in json.loads((g.CONFIG_DIR / "classification-overrides.json").read_text(encoding="utf-8")).items() if not k.startswith("_")}
cats = config["categories"]
rules = g.compile_rules(config)
arts = g.load_events()
g.classify(arts, rules, overrides, cats)

by = {}
for a in arts:
    by.setdefault(a["cat"], []).append(a)

order = sys.argv[1:] or ["Q", "P", "O", "M", "L", "N", "J", "G", "H", "E", "F", "I", "K", "C", "D", "A", "B"]
for cid in order:
    if cid not in by:
        continue
    print(f"=== {cid} {cats[cid]['name']} ({len(by[cid])}) ===")
    for a in by[cid]:
        print(f"  {a['date']} | {a['title'][:58]} | {a['basis']} {a['matched'][:24]}")
