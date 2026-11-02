# TSLBench

**TSLBench** is a benchmark for evaluating Retrieval-Augmented Generation (RAG) on Turkish sports legislation. This repository publishes the **TSLBench200** dataset, pre-computed benchmark results, metric computation scripts, and an interactive **results viewer**.

## Contents

| Path | Description |
|------|-------------|
| `data/TSLBench200_dataset.json` | 200-question mixed single/multi-hop benchmark set |
| `data/TSLBench200_results.json` | Pre-computed BasicRAG / GraphRAG / LightRAG evaluation results |
| `scripts/compute_metrics.py` | Offline metric reproduction (SAR, RAGAS, latency, by-type) |
| `backend/metrics.py` | Runtime metric aggregation used by the viewer API |
| `frontend/` | Single-page React dashboard (metrics, charts, comparison matrix) |

## Quick start (view results)

```bash
# 1. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r ../requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run build

# 3. Open http://127.0.0.1:8000
```

Development mode (hot reload):

```bash
# Terminal 1 — API
cd backend && uvicorn main:app --reload --port 8000

# Terminal 2 — Vite dev server (proxies /api to :8000)
cd frontend && npm install && npm run dev
# Open http://localhost:5173
```

## Metrics (offline)

Reproduce paper metrics from a results JSON file:

```bash
python scripts/compute_metrics.py data/TSLBench200_results.json
python scripts/compute_metrics.py data/TSLBench200_results.json --json out_metrics.json
```

## Paper figures (`docs/figures/`)

Static PNG plots for the repository README and manuscript are generated from the released results file:

```bash
pip install matplotlib numpy   # if not already installed
python scripts/plot_tslbench_figures.py
python scripts/plot_tslbench_figures.py path/to/results.json   # optional override
```

Re-run this after updating `TSLBench200_results.json` or gold lists so SAR / by-type bars match `backend/metrics.py`.

## API keys

**No API keys are included in this repository.** The bundled viewer loads pre-computed results only.

If you fork this repo to run new evaluations, create a `.env` file from `.env.example` and supply your own provider keys. Do not commit `.env`.

## Dataset format

`TSLBench200_dataset.json` contains 200 questions across six Turkish sports laws with gold `relevant_article_list`, `question_type` (single-hop / multi-hop), and reference answers.

## Citation

If you use TSLBench in your research, please cite:

```bibtex
@article{ay2026tslbench,
  author  = {Ay, Betul and Ozturk, Mehmet Ata and Tatar, Samet and Aydin, Galip},
  title   = {{TSLBench}: A Source-Grounded Benchmark for Retrieval-Augmented
             Question-Answering on Turkish Sports Legislation},
  journal = {IEEE Access},
  year    = {2026},
  note    = {Under review}
}
```

## License

- Code (`backend/`, `frontend/`, `scripts/`): MIT License, see [LICENSE](LICENSE).
- Dataset (`data/`): CC BY 4.0, see [data/LICENSE](data/LICENSE).
