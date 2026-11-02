#!/usr/bin/env python3
"""
compute_metrics.py
==================
Reproduces every metric reported in the TSLBench paper from a benchmark
results file (the rag_benchmark_results_*.json produced by the evaluation
dashboard).

It computes, for BasicRAG / GraphRAG / LightRAG:

  A. Article-level RETRIEVAL metrics (judge-independent), from the ordered
     `sources` list and the gold `relevant_article_list`:
       SAR (macro recall), SAR (micro), Recall@k, Coverage (full),
       Coverage@k, Hit rate, MRR, MAP, plus the precision/F1 already stored.
  B. RAGAS answer-quality aggregates (faithfulness, answer relevance,
     factual correctness, context precision, context recall).
  C. judge_details-derived metrics (claim support rate, context-chunk
     precision, factual-correctness F1, attributed context recall, #claims).
  D. Latency statistics (mean / median / p90 / p95 / max).
  E. Breakdown by question type (single-hop vs multi-hop)  -> paper Table 6.
  F. Dataset statistics (per-law gold counts, distinct articles, average
     gold articles, multi-hop multi-article and cross-statute counts)
     -> paper Tables 2 and 3.

Usage:
    python compute_metrics.py rag_benchmark_results_2026-05-30T01_20_42Z.json
    python compute_metrics.py results.json --json out_metrics.json   # also dump JSON

Notes:
- Metrics are reported to 3 decimals to match the paper.
- "k" for Recall@k / Coverage@k defaults to 3 and 5 (change K_VALUES below).
- The medium/hard split is NOT stored in the results file (only single/multi),
  so the per-difficulty composition (50 questions per cell) is read from the
  dataset files, not recomputed here; this script reports the single/multi
  split and averages that ARE derivable from the results.
"""

import json
import sys
import argparse
import statistics as st

SYSTEMS = ["basic_rag", "graph_rag", "light_rag"]
LABEL = {"basic_rag": "BasicRAG", "graph_rag": "GraphRAG", "light_rag": "LightRAG"}
K_VALUES = [3, 5]
RAGAS_KEYS = ["faithfulness", "answer_relevance", "factual_correctness",
              "context_precision", "context_recall"]


# ----------------------------- helpers -------------------------------------
def norm_type(t):
    """Normalise the question-type label ('single-hop' / 'single_hop' -> single_hop)."""
    return "single_hop" if str(t).startswith("single") else "multi_hop"


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else float("nan")


def recall(retrieved, gold):
    g = set(gold)
    return len(g & set(retrieved)) / len(g) if g else 0.0


def precision(retrieved, gold):
    g = set(gold or [])
    r = set(retrieved or [])
    if not r:
        return 0.0
    return len(g & r) / len(r) if g else 0.0


def coverage_full(retrieved, gold):
    """1.0 if every gold article is in the retrieved set, else 0.0."""
    return 1.0 if set(gold) <= set(retrieved) else 0.0


def hit_rate(retrieved, gold):
    return 1.0 if set(retrieved) & set(gold) else 0.0


def mrr(retrieved, gold):
    """Reciprocal rank of the first gold article in the ordered list."""
    g = set(gold)
    for i, a in enumerate(retrieved, 1):
        if a in g:
            return 1.0 / i
    return 0.0


def average_precision(retrieved, gold):
    """Average precision over the ordered retrieved list (for MAP)."""
    g = set(gold)
    if not g:
        return 0.0
    hits, score = 0, 0.0
    for i, a in enumerate(retrieved, 1):
        if a in g:
            hits += 1
            score += hits / i
    return score / len(g)


def law_of(article_id):
    """Law number is the prefix before the first '-'  (e.g. '7405-article_5' -> '7405')."""
    return str(article_id).split("-")[0]


def fmt_row(name, vals, width=22):
    return f"{name:<{width}}" + "".join(f"{v:>11.3f}" if isinstance(v, float) else f"{v:>11}" for v in vals)


# ----------------------------- core ----------------------------------------
def compute(results):
    out = {"systems": {LABEL[s]: {} for s in SYSTEMS}}

    # ---- A. retrieval metrics ----
    for s in SYSTEMS:
        d = out["systems"][LABEL[s]]
        rets = [(x[s].get("sources") or [], x["relevant_article_list"]) for x in results]
        d["SAR_macro"] = mean([recall(r, g) for r, g in rets])
        inter = sum(len(set(r) & set(g)) for r, g in rets)
        tot = sum(len(set(g)) for r, g in rets)
        d["SAR_micro"] = inter / tot if tot else float("nan")
        for k in K_VALUES:
            d[f"Recall@{k}"] = mean([recall(r[:k], g) for r, g in rets])
            d[f"Coverage@{k}_full"] = mean([coverage_full(r[:k], g) for r, g in rets])
        d["Coverage_full"] = mean([coverage_full(r, g) for r, g in rets])
        d["HitRate"] = mean([hit_rate(r, g) for r, g in rets])
        d["MRR"] = mean([mrr(r, g) for r, g in rets])
        d["MAP"] = mean([average_precision(r, g) for r, g in rets])
        d["avg_retrieved"] = mean([len(r) for r, g in rets])
        d["precision_macro"] = mean([precision(r, g) for r, g in rets])
        d["recall_macro"] = mean([recall(r, g) for r, g in rets])
        d["f1_macro"] = mean([
            2 * precision(r, g) * recall(r, g) / (precision(r, g) + recall(r, g))
            if (precision(r, g) + recall(r, g)) > 0
            else 0.0
            for r, g in rets
        ])

    # ---- B. RAGAS aggregates ----
    for s in SYSTEMS:
        d = out["systems"][LABEL[s]]
        for k in RAGAS_KEYS:
            d[f"ragas_{k}"] = mean([(x[s].get("ragas_scores") or {}).get(k) for x in results])

    # ---- C. judge_details-derived ----
    def jd(x, s):
        return x[s].get("judge_details") or {}

    for s in SYSTEMS:
        d = out["systems"][LABEL[s]]
        # claim support rate = fraction of answer statements judged supported
        supp = []
        chunkP = []
        factF1 = []
        attr = []
        nclaims = []
        for x in results:
            j = jd(x, s)
            fl = j.get("faithfulness") or []
            if fl:
                supp.append(mean([1.0 if c.get("verdict") == 1 else 0.0 for c in fl]))
                nclaims.append(len(fl))
            cp = j.get("context_precision") or []
            if cp:
                chunkP.append(mean([1.0 if c.get("verdict") == 1 else 0.0 for c in cp]))
            fc = j.get("factual_correctness") or {}
            p, r = fc.get("precision"), fc.get("recall")
            if isinstance(p, (int, float)) and isinstance(r, (int, float)) and (p + r) > 0:
                factF1.append(2 * p * r / (p + r))
            cr = j.get("context_recall") or []
            if cr:
                attr.append(mean([1.0 if c.get("attributed") == 1 else 0.0 for c in cr]))
        d["claim_support_rate"] = mean(supp)
        d["ctx_chunk_precision"] = mean(chunkP)
        d["factual_F1_from_PR"] = mean(factF1)
        d["ctx_recall_attributed"] = mean(attr)
        d["avg_answer_claims"] = mean(nclaims)

    # ---- D. latency ----
    for s in SYSTEMS:
        d = out["systems"][LABEL[s]]
        L = sorted(float(x[s]["latency"]) for x in results if isinstance(x[s].get("latency"), (int, float)))
        if L:
            d["latency_mean"] = mean(L)
            d["latency_median"] = st.median(L)
            d["latency_p90"] = L[int(0.90 * (len(L) - 1))]
            d["latency_p95"] = L[int(0.95 * (len(L) - 1))]
            d["latency_max"] = max(L)

    # ---- E. by question type ----
    out["by_type"] = {}
    for s in SYSTEMS:
        out["by_type"][LABEL[s]] = {}
        for qt in ["single_hop", "multi_hop"]:
            sub = [x for x in results if norm_type(x["question_type"]) == qt]
            ent = {
                "n": len(sub),
                "SAR": mean([recall(x[s].get("sources") or [], x["relevant_article_list"]) for x in sub]),
                "Coverage_full": mean([coverage_full(x[s].get("sources") or [], x["relevant_article_list"]) for x in sub]),
                "faithfulness": mean([(x[s].get("ragas_scores") or {}).get("faithfulness") for x in sub]),
                "factual_correctness": mean([(x[s].get("ragas_scores") or {}).get("factual_correctness") for x in sub]),
            }
            out["by_type"][LABEL[s]][qt] = ent

    # ---- F. dataset statistics ----
    law_counts, arts = {}, set()
    for x in results:
        for a in x["relevant_article_list"]:
            law_counts[law_of(a)] = law_counts.get(law_of(a), 0) + 1
            arts.add(a)
    sh = [x for x in results if norm_type(x["question_type"]) == "single_hop"]
    mh = [x for x in results if norm_type(x["question_type"]) == "multi_hop"]
    out["dataset"] = {
        "n_total": len(results),
        "n_single": len(sh),
        "n_multi": len(mh),
        "per_law_gold_counts": dict(sorted(law_counts.items(), key=lambda kv: -kv[1])),
        "total_gold_mentions": sum(law_counts.values()),
        "distinct_articles": len(arts),
        "avg_gold_single": mean([len(x["relevant_article_list"]) for x in sh]),
        "avg_gold_multi": mean([len(x["relevant_article_list"]) for x in mh]),
        "multi_with_more_than_one_article": sum(1 for x in mh if len(x["relevant_article_list"]) > 1),
        "multi_cross_statute": sum(1 for x in mh if len({law_of(a) for a in x["relevant_article_list"]}) >= 2),
    }
    return out


# ----------------------------- pretty print --------------------------------
def report(meta, m):
    S = [LABEL[s] for s in SYSTEMS]
    print("=" * 74)
    print(f"generator = {meta.get('generator_model')}   judge = {meta.get('judge_model')}")
    print(f"questions = {len(meta['results'])}   status = {meta.get('status')}   completed = {meta.get('completed')}")
    print("=" * 74)

    def block(title, keys, labels=None):
        print(f"\n--- {title} ---")
        print(f"{'metric':<22}" + "".join(f"{x:>11}" for x in S))
        for i, k in enumerate(keys):
            name = labels[i] if labels else k
            print(fmt_row(name, [m["systems"][s][k] for s in S]))

    block("A. RETRIEVAL (judge-independent)",
          ["SAR_macro", "SAR_micro", "Recall@3", "Recall@5", "Coverage_full",
           "Coverage@5_full", "HitRate", "MRR", "MAP", "avg_retrieved"],
          ["SAR (macro)", "SAR (micro)", "Recall@3", "Recall@5", "Coverage full",
           "Coverage@5 full", "Hit rate", "MRR", "MAP", "avg #retrieved"])

    block("B. RAGAS", [f"ragas_{k}" for k in RAGAS_KEYS], RAGAS_KEYS)

    block("C. judge_details-derived",
          ["claim_support_rate", "ctx_chunk_precision", "factual_F1_from_PR",
           "ctx_recall_attributed", "avg_answer_claims"])

    print("\n--- D. LATENCY (s) ---")
    for s in S:
        d = m["systems"][s]
        print(f"  {s:<10} mean={d['latency_mean']:6.2f} median={d['latency_median']:6.2f} "
              f"p90={d['latency_p90']:6.2f} p95={d['latency_p95']:6.2f} max={d['latency_max']:7.2f}")

    print("\n--- E. BY QUESTION TYPE (paper Table 6) ---")
    for s in S:
        for qt in ["single_hop", "multi_hop"]:
            e = m["by_type"][s][qt]
            print(f"  {s:<10} {qt:<11} n={e['n']:3d}  SAR={e['SAR']:.3f}  "
                  f"Cov={e['Coverage_full']:.3f}  faith={e['faithfulness']:.3f}  "
                  f"factcorr={e['factual_correctness']:.3f}")

    print("\n--- F. DATASET (paper Tables 2 and 3) ---")
    ds = m["dataset"]
    print(f"  total={ds['n_total']}  single={ds['n_single']}  multi={ds['n_multi']}")
    print(f"  per-law gold counts: {ds['per_law_gold_counts']}")
    print(f"  total gold mentions={ds['total_gold_mentions']}  distinct articles={ds['distinct_articles']}")
    print(f"  avg gold: single={ds['avg_gold_single']:.2f}  multi={ds['avg_gold_multi']:.2f}")
    print(f"  multi-hop with >1 article: {ds['multi_with_more_than_one_article']} of {ds['n_multi']}")
    print(f"  multi-hop cross-statute (>=2 laws): {ds['multi_cross_statute']} of {ds['n_multi']}")


# ----------------------------- main ----------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Compute TSLBench paper metrics from a results JSON.")
    ap.add_argument("results", help="path to rag_benchmark_results_*.json")
    ap.add_argument("--json", dest="dump", help="optional path to dump all metrics as JSON")
    args = ap.parse_args()

    with open(args.results, encoding="utf-8") as f:
        meta = json.load(f)
    results = meta["results"]
    m = compute(results)
    report(meta, m)

    if args.dump:
        with open(args.dump, "w", encoding="utf-8") as f:
            json.dump(m, f, ensure_ascii=False, indent=2)
        print(f"\n[written] {args.dump}")


if __name__ == "__main__":
    main()
