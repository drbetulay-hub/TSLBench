#!/usr/bin/env python3
"""Generate TSLBench paper figures from benchmark results JSON."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RESULTS = ROOT / "data/TSLBench200_results.json"
OUT_DIR = ROOT / "docs/figures"

SYSTEMS = ["basic_rag", "graph_rag", "light_rag"]
LABELS = {"basic_rag": "BasicRAG", "graph_rag": "GraphRAG", "light_rag": "LightRAG"}
PIPE_COLORS = {"basic_rag": "#2563eb", "graph_rag": "#7c3aed", "light_rag": "#059669"}
STAT_COLORS = ["#2563eb", "#7c3aed", "#ea580c"]

plt.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Inter", "DejaVu Sans", "Arial"],
    "font.size": 11,
    "axes.labelsize": 12,
    "axes.titlesize": 13,
    "xtick.labelsize": 10,
    "ytick.labelsize": 10,
    "legend.fontsize": 10,
    "figure.dpi": 150,
    "savefig.dpi": 300,
    "axes.spines.top": False,
    "axes.spines.right": False,
})


def recall(sources, gold):
    g = set(gold or [])
    if not g:
        return 0.0
    return len(g & set(sources or [])) / len(g)


def load_results(path: Path) -> list:
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("results") or data


def classify_failure_modes(results: list, sar_thr=0.5, faith_thr=0.7) -> dict:
    counts = {s: {"success": 0, "retrieval": 0, "generation": 0, "both": 0} for s in SYSTEMS}
    for row in results:
        gold = row.get("relevant_article_list") or []
        if not gold:
            continue
        for s in SYSTEMS:
            item = row.get(s)
            if not item:
                continue
            sar = recall(item.get("sources"), gold)
            faith = (item.get("ragas_scores") or {}).get("faithfulness") or 0.0
            r_fail = sar < sar_thr
            g_fail = faith < faith_thr
            if r_fail and g_fail:
                counts[s]["both"] += 1
            elif r_fail:
                counts[s]["retrieval"] += 1
            elif g_fail:
                counts[s]["generation"] += 1
            else:
                counts[s]["success"] += 1
    return counts


def save(fig, name: str):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT_DIR / f"{name}.png", bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"  saved {name}.png")


def plot_failure_modes(counts: dict):
    fig, ax = plt.subplots(figsize=(8, 4.5))
    modes = ["success", "retrieval", "generation", "both"]
    mode_labels = ["Success", "Retrieval fail", "Generation fail", "Both"]
    mode_colors = ["#059669", "#2563eb", "#ea580c", "#dc2626"]
    x = np.arange(len(SYSTEMS))
    width = 0.6
    bottom = np.zeros(len(SYSTEMS))
    for mode, label, color in zip(modes, mode_labels, mode_colors):
        vals = [counts[s][mode] for s in SYSTEMS]
        ax.bar(x, vals, width, bottom=bottom, label=label, color=color, edgecolor="white", linewidth=0.5)
        bottom += np.array(vals)
    ax.set_xticks(x)
    ax.set_xticklabels([LABELS[s] for s in SYSTEMS])
    ax.set_ylabel("Number of questions (N=200)")
    ax.set_title("Failure Mode Analysis by Pipeline")
    ax.legend(loc="upper right", frameon=True)
    ax.set_ylim(0, max(bottom) * 1.08)
    save(fig, "fig_failure_modes")


def plot_sar_by_type(metrics: dict):
    fig, ax = plt.subplots(figsize=(7, 4.5))
    x = np.arange(len(SYSTEMS))
    w = 0.35
    single = [metrics["by_type"][s]["single_hop"]["sar"] * 100 for s in SYSTEMS]
    multi = [metrics["by_type"][s]["multi_hop"]["sar"] * 100 for s in SYSTEMS]
    ax.bar(x - w / 2, single, w, label="Single-hop SAR", color=STAT_COLORS[0])
    ax.bar(x + w / 2, multi, w, label="Multi-hop SAR", color=STAT_COLORS[2])
    ax.set_xticks(x)
    ax.set_xticklabels([LABELS[s] for s in SYSTEMS])
    ax.set_ylabel("Statute Article Recall (%)")
    ax.set_title("SAR by Question Type")
    ax.legend(loc="upper right")
    ax.set_ylim(0, 100)
    save(fig, "fig_sar_by_question_type")


def plot_horizontal_metrics(metrics: dict, keys, labels, title, filename):
    fig, ax = plt.subplots(figsize=(8, 4 + 0.4 * len(keys)))
    y = np.arange(len(keys))
    h = 0.22
    for i, s in enumerate(SYSTEMS):
        vals = [metrics["systems"][s].get(k, 0) for k in keys]
        ax.barh(y + (i - 1) * h, vals, h, label=LABELS[s], color=PIPE_COLORS[s])
    ax.set_yticks(y)
    ax.set_yticklabels(labels)
    ax.set_xlabel("Average Score (0.0 to 1.0)")
    ax.set_title(title)
    ax.set_xlim(0, 1.05)
    ax.legend(loc="lower right")
    ax.invert_yaxis()
    save(fig, filename)


def plot_latency(metrics: dict):
    fig, ax = plt.subplots(figsize=(7, 4.5))
    stats = ["latency_mean", "latency_median", "latency_p90"]
    stat_labels = ["Mean", "Median", "P90"]
    x = np.arange(len(SYSTEMS))
    w = 0.25
    for i, (key, label, color) in enumerate(zip(stats, stat_labels, STAT_COLORS)):
        vals = [metrics["systems"][s].get(key, 0) for s in SYSTEMS]
        ax.bar(x + (i - 1) * w, vals, w, label=label, color=color)
    ax.set_xticks(x)
    ax.set_xticklabels([LABELS[s] for s in SYSTEMS])
    ax.set_ylabel("Response Time (s)")
    ax.set_title("Latency Distribution")
    ax.legend(loc="upper right")
    save(fig, "fig_latency_distribution")


def plot_scatter_sar_faith(results: list):
    fig, ax = plt.subplots(figsize=(7, 5.5))
    for s in SYSTEMS:
        xs, ys = [], []
        for row in results:
            gold = row.get("relevant_article_list") or []
            item = row.get(s)
            if not item or not gold:
                continue
            xs.append(recall(item.get("sources"), gold))
            ys.append((item.get("ragas_scores") or {}).get("faithfulness") or 0.0)
        ax.scatter(xs, ys, alpha=0.45, s=28, c=PIPE_COLORS[s], label=LABELS[s], edgecolors="none")
    ax.axvline(0.5, color="#94a3b8", linestyle="--", linewidth=1, label="SAR threshold")
    ax.axhline(0.7, color="#cbd5e1", linestyle=":", linewidth=1, label="Faith threshold")
    ax.set_xlabel("SAR (retrieval)")
    ax.set_ylabel("Faithfulness (generation)")
    ax.set_title("Retrieval vs Generation Quality (per question)")
    ax.set_xlim(-0.02, 1.02)
    ax.set_ylim(-0.02, 1.02)
    ax.legend(loc="lower right", fontsize=9)
    save(fig, "fig_retrieval_vs_faithfulness_scatter")


def plot_multi_hop_drop(metrics: dict):
    fig, ax = plt.subplots(figsize=(6, 4))
    drops = []
    for s in SYSTEMS:
        sh = metrics["by_type"][s]["single_hop"]["sar"] * 100
        mh = metrics["by_type"][s]["multi_hop"]["sar"] * 100
        drops.append(sh - mh)
    colors = [PIPE_COLORS[s] for s in SYSTEMS]
    ax.bar([LABELS[s] for s in SYSTEMS], drops, color=colors)
    ax.set_ylabel("SAR drop: single-hop → multi-hop (pp)")
    ax.set_title("Multi-hop Retrieval Penalty")
    ax.axhline(0, color="#64748b", linewidth=0.8)
    for i, v in enumerate(drops):
        ax.text(i, v + 0.3, f"{v:.1f}", ha="center", fontsize=10)
    save(fig, "fig_multi_hop_sar_drop")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("results", nargs="?", default=str(DEFAULT_RESULTS))
    args = parser.parse_args()
    path = Path(args.results)
    if not path.exists():
        print(f"Results not found: {path}", file=sys.stderr)
        sys.exit(1)

    backend = ROOT / "backend"
    sys.path.insert(0, str(backend))
    from metrics import compute_tslbench_metrics

    results = load_results(path)
    metrics = compute_tslbench_metrics(results)
    print(f"Loaded {len(results)} questions from {path}")
    print(
        "SAR macro:",
        {LABELS[s]: round(metrics["systems"][s]["sar_macro"], 4) for s in SYSTEMS},
    )

    counts = classify_failure_modes(results)
    print("Failure modes:", counts)

    print(f"Writing figures to {OUT_DIR}/")
    plot_failure_modes(counts)
    plot_sar_by_type(metrics)
    plot_horizontal_metrics(
        metrics,
        ["sar_macro", "coverage_full", "hit_rate", "mrr", "map"],
        ["SAR", "Coverage", "Hit Rate", "MRR", "MAP"],
        "Retrieval Performance",
        "fig_retrieval_performance",
    )
    plot_horizontal_metrics(
        metrics,
        ["ragas_faithfulness", "ragas_answer_relevance", "ragas_factual_correctness",
         "ragas_context_precision", "ragas_context_recall"],
        ["Faithfulness", "Answer Relevance", "Factual Correctness", "Context Precision", "Context Recall"],
        "Answer Quality (RAGAS)",
        "fig_ragas_quality",
    )
    plot_latency(metrics)
    plot_scatter_sar_faith(results)
    plot_multi_hop_drop(metrics)
    print("Done.")


if __name__ == "__main__":
    main()
