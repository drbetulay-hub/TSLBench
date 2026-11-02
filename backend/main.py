# -*- coding: utf-8 -*-
"""TSLBench — lightweight server for benchmark results viewer."""

from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from metrics import compute_tslbench_metrics

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RESULTS_FILE = DATA_DIR / "TSLBench200_results.json"
DATASET_FILE = DATA_DIR / "TSLBench200_dataset.json"
FRONTEND_DIST = ROOT / "frontend" / "dist"

app = FastAPI(title="TSLBench Results Viewer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _load_results() -> dict:
    if not RESULTS_FILE.exists():
        raise HTTPException(status_code=404, detail="Results file not found")
    with open(RESULTS_FILE, encoding="utf-8") as f:
        data = json.load(f)
    if data.get("results"):
        data["computed_metrics"] = compute_tslbench_metrics(data["results"])
    data.setdefault("completed", True)
    data.setdefault("questions_count", len(data.get("results") or []))
    return data


@app.get("/api/results")
def get_results():
    return _load_results()


@app.get("/api/dataset")
def get_dataset():
    if not DATASET_FILE.exists():
        raise HTTPException(status_code=404, detail="Dataset file not found")
    with open(DATASET_FILE, encoding="utf-8") as f:
        return json.load(f)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "results": RESULTS_FILE.exists(),
        "dataset": DATASET_FILE.exists(),
    }


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/")
    def index():
        index_path = FRONTEND_DIST / "index.html"
        if not index_path.exists():
            raise HTTPException(status_code=404, detail="Frontend not built")
        return FileResponse(index_path)

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        asset = FRONTEND_DIST / full_path
        if asset.is_file():
            return FileResponse(asset)
        return FileResponse(FRONTEND_DIST / "index.html")
else:

    @app.get("/")
    def index_dev():
        return HTMLResponse(
            "<h1>TSLBench</h1><p>Build the frontend: <code>cd frontend && npm run build</code></p>"
        )
