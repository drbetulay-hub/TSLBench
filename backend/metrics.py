"""TSLBench metric computation (SAR, RAGAS, latency, by-type breakdown)."""

from __future__ import annotations

import statistics


SYSTEMS = ["basic_rag", "graph_rag", "light_rag"]
K_VALUES = [3, 5]
RAGAS_KEYS = [
    "faithfulness",
    "answer_relevance",
    "factual_correctness",
    "context_precision",
    "context_recall",
]


def _safe_mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else 0.0


def _recall(retrieved, gold):
    g = set(gold)
    return len(g & set(retrieved)) / len(g) if g else 0.0


def _precision(retrieved, gold):
    g = set(gold or [])
    r = set(retrieved or [])
    if not r:
        return 0.0
    return len(g & r) / len(r) if g else 0.0


def _f1_score(precision: float, recall: float) -> float:
    return (
        2 * precision * recall / (precision + recall)
        if (precision + recall) > 0
        else 0.0
    )


def article_level_scores(retrieved, gold) -> dict[str, float]:
    """Per-question article metrics; recall matches Statute Article Recall (SAR)."""
    rec = _recall(retrieved, gold)
    prec = _precision(retrieved, gold)
    f1 = _f1_score(prec, rec)
    return {
        "article_recall": round(rec, 6),
        "article_precision": round(prec, 6),
        "article_f1": round(f1, 6),
    }


def _coverage_full(retrieved, gold):
    return 1.0 if set(gold) <= set(retrieved) else 0.0


def _hit_rate(retrieved, gold):
    return 1.0 if set(retrieved) & set(gold) else 0.0


def _mrr(retrieved, gold):
    g = set(gold)
    for i, article in enumerate(retrieved, 1):
        if article in g:
            return 1.0 / i
    return 0.0


def _average_precision(retrieved, gold):
    g = set(gold)
    if not g:
        return 0.0
    hits, score = 0, 0.0
    for i, article in enumerate(retrieved, 1):
        if article in g:
            hits += 1
            score += hits / i
    return score / len(g)


def _question_type_prefix(row: dict) -> str:
    return str(row.get("question_type", "")).replace("-", "_").split("_")[0]


def _subset_by_question_type(results: list, system: str, qt: str) -> list:
    prefix = qt.split("_")[0]
    return [
        row
        for row in results
        if row.get(system)
        and _question_type_prefix(row) == prefix
    ]


def compute_tslbench_metrics(results: list) -> dict:
    """Compute aggregated TSLBench metrics from per-question results."""
    metrics = {"systems": {}}

    for system in SYSTEMS:
        d = {}
        pairs = []
        for row in results:
            if row.get(system) and row.get("relevant_article_list"):
                pairs.append((row[system].get("sources") or [], row["relevant_article_list"]))

        if not pairs:
            continue

        d["sar_macro"] = _safe_mean([_recall(r, g) for r, g in pairs])
        inter = sum(len(set(r) & set(g)) for r, g in pairs)
        tot = sum(len(set(g)) for r, g in pairs)
        d["sar_micro"] = inter / tot if tot else 0.0

        for k in K_VALUES:
            d[f"recall_at_{k}"] = _safe_mean([_recall(r[:k], g) for r, g in pairs])
            d[f"coverage_at_{k}"] = _safe_mean([_coverage_full(r[:k], g) for r, g in pairs])

        d["coverage_full"] = _safe_mean([_coverage_full(r, g) for r, g in pairs])
        d["hit_rate"] = _safe_mean([_hit_rate(r, g) for r, g in pairs])
        d["mrr"] = _safe_mean([_mrr(r, g) for r, g in pairs])
        d["map"] = _safe_mean([_average_precision(r, g) for r, g in pairs])
        d["avg_retrieved"] = _safe_mean([len(r) for r, g in pairs])

        for key in RAGAS_KEYS:
            vals = [
                (row[system].get("ragas_scores") or {}).get(key)
                for row in results
                if row.get(system)
            ]
            d[f"ragas_{key}"] = _safe_mean(vals)

        supp, chunk_p, fact_f1, attr, nclaims = [], [], [], [], []
        for row in results:
            if not row.get(system):
                continue
            judge = row[system].get("judge_details") or {}

            faith = judge.get("faithfulness") or []
            if faith:
                supp.append(_safe_mean([1.0 if c.get("verdict") == 1 else 0.0 for c in faith]))
                nclaims.append(len(faith))

            ctx_p = judge.get("context_precision") or []
            if ctx_p:
                chunk_p.append(_safe_mean([1.0 if c.get("verdict") == 1 else 0.0 for c in ctx_p]))

            fc = judge.get("factual_correctness") or {}
            p, r = fc.get("precision"), fc.get("recall")
            if isinstance(p, (int, float)) and isinstance(r, (int, float)) and (p + r) > 0:
                fact_f1.append(2 * p * r / (p + r))

            ctx_r = judge.get("context_recall") or []
            if ctx_r:
                attr.append(_safe_mean([1.0 if c.get("attributed") == 1 else 0.0 for c in ctx_r]))

        d["claim_support_rate"] = _safe_mean(supp)
        d["ctx_chunk_precision"] = _safe_mean(chunk_p)
        d["factual_f1"] = _safe_mean(fact_f1)
        d["ctx_recall_attributed"] = _safe_mean(attr)
        d["avg_answer_claims"] = _safe_mean(nclaims)

        latencies = sorted(
            float(row[system]["latency"])
            for row in results
            if row.get(system) and isinstance(row[system].get("latency"), (int, float))
        )
        if latencies:
            d["latency_mean"] = _safe_mean(latencies)
            d["latency_median"] = statistics.median(latencies)
            d["latency_p90"] = latencies[int(0.90 * (len(latencies) - 1))]
            d["latency_p95"] = latencies[int(0.95 * (len(latencies) - 1))]
            d["latency_max"] = max(latencies)

        d["count"] = len(pairs)
        metrics["systems"][system] = d

    metrics["by_type"] = {}
    for system in SYSTEMS:
        if system not in metrics["systems"]:
            continue
        metrics["by_type"][system] = {}
        for qt in ["single_hop", "multi_hop"]:
            subset = _subset_by_question_type(results, system, qt)
            if not subset:
                continue
            pairs = [
                (row[system].get("sources") or [], row["relevant_article_list"])
                for row in subset
            ]
            entry = {
                "n": len(subset),
                "sar": _safe_mean([_recall(r, g) for r, g in pairs]),
                "coverage_full": _safe_mean([_coverage_full(r, g) for r, g in pairs]),
                "hit_rate": _safe_mean([_hit_rate(r, g) for r, g in pairs]),
                "mrr": _safe_mean([_mrr(r, g) for r, g in pairs]),
                "map": _safe_mean([_average_precision(r, g) for r, g in pairs]),
                "faithfulness": _safe_mean([
                    (row[system].get("ragas_scores") or {}).get("faithfulness")
                    for row in subset
                ]),
                "factual_correctness": _safe_mean([
                    (row[system].get("ragas_scores") or {}).get("factual_correctness")
                    for row in subset
                ]),
                "answer_relevance": _safe_mean([
                    (row[system].get("ragas_scores") or {}).get("answer_relevance")
                    for row in subset
                ]),
                "context_precision": _safe_mean([
                    (row[system].get("ragas_scores") or {}).get("context_precision")
                    for row in subset
                ]),
                "context_recall": _safe_mean([
                    (row[system].get("ragas_scores") or {}).get("context_recall")
                    for row in subset
                ]),
            }
            for k in K_VALUES:
                entry[f"recall_at_{k}"] = _safe_mean([_recall(r[:k], g) for r, g in pairs])
                entry[f"coverage_at_{k}"] = _safe_mean([_coverage_full(r[:k], g) for r, g in pairs])
            metrics["by_type"][system][qt] = entry

    metrics["meta"] = {
        "n_single_hop": sum(1 for row in results if _question_type_prefix(row) == "single"),
        "n_multi_hop": sum(1 for row in results if _question_type_prefix(row) == "multi"),
        "n_total": len(results),
    }
    return metrics
