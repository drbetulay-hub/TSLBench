#!/usr/bin/env python3
"""Recompute article_recall / article_precision / article_f1 from current gold lists."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from metrics import SYSTEMS, article_level_scores, compute_tslbench_metrics  # noqa: E402

RESULTS_PATH = ROOT / "data" / "TSLBench200_results.json"


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else RESULTS_PATH
    data = json.loads(path.read_text(encoding="utf-8"))
    results = data.get("results") or []
    n = 0
    for row in results:
        gold = row.get("relevant_article_list") or []
        for system in SYSTEMS:
            block = row.get(system)
            if not block:
                continue
            scores = article_level_scores(block.get("sources") or [], gold)
            block.update(scores)
            n += 1
    data["results"] = results
    data["computed_metrics"] = compute_tslbench_metrics(results)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    m = data["computed_metrics"]["systems"]
    print(f"Updated {n} pipeline rows in {path}")
    for s in SYSTEMS:
        sar = m[s]["sar_macro"]
        mean_rec = sum(r[s]["article_recall"] for r in results if r.get(s)) / len(results)
        print(f"  {s}: SAR macro {sar:.6f}, mean article_recall {mean_rec:.6f}")


if __name__ == "__main__":
    main()
