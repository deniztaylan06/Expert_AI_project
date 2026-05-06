# Italian Financial Challenge — Revenue Change Forecasting

**Challenge 3 · LUISS University · Academic Year 2025/2026**

**Team:** Deniz Mehmet Taylan · Gustavo Depieri Fioravanti · Yarkin Yavuz · Koray Aydin

---

## What We Do

We forecast `revenue_change_next` — the percentage change in a company's production value over the next fiscal year — using panel financial statements from Italian companies covering 2018–2023.

This is a hard regression problem for two reasons:
- The target distribution is **heavy-tailed**: a small number of collapse and breakout events dominate naive error metrics.
- **Near-zero denominators** make raw MAPE unstable when current-year revenue is very small.

Our solution is built in two parts:
1. A **machine learning pipeline** (`notebook/revenue_change.ipynb`) that trains, evaluates, and exports predictions.
2. An **interactive React dashboard** (`vite-project/`) that visualises the training data, model signals, and predictions.

---

## Why This Matters

Predicting revenue change from annual balance sheets is not a solved problem. Accounting statements are noisy, firms enter and exit the panel for structural reasons, and the same reported growth rate can mean very different things depending on a firm's size, sector, and recent history. Our approach builds interpretable, leakage-safe features grounded in financial economics, then evaluates them with metrics that stay meaningful even in the difficult tail regions.

---

## How We Do It

### Machine Learning Pipeline

| Stage | Key Decisions |
|---|---|
| **Target** | Fit on `log(production_value_next)`; convert predictions back to `revenue_change_next` |
| **Splits** | Strictly time-based — `2018–2019 → 2020` for selection, `2018–2020 → 2021` locked holdout |
| **Feature families** | Lagged growth & acceleration · margin quality · balance-sheet pressure · peer-relative context · regime/event flags |
| **Models** | Lasso (clean base) + CatBoost (sensitivity check) |
| **Evaluation** | TMAPE (95% coverage), WAPE, SMAPE, directional accuracy, Spearman rank correlation |
| **Add-on** | Five-bucket and three-bucket regime classifiers for business communication |

No random train/test splits are used anywhere. All scaling, imputation, and grouped priors are fit on training years only.

### Interactive Dashboard

A single-page React application loads the training CSV directly in the browser and computes all charts client-side — no backend required. Built with Vite, Recharts, and `qrcode.react`.

Charts included: revenue-change bucket distribution · sector COVID impact · regional heatmap · revenue-tier outcome rates · tier persistence · equity-gap signal · growth momentum · correlation matrices · 2024 forward predictions.

---

## Project Structure

```
Expert_AI_project/
├── notebook/
│   └── revenue_change.ipynb       # Full ML pipeline (EDA → features → models → export)
│
├── outputs/
│   ├── revenue_change_2024_predictions.csv        # Forward-looking 2024 forecasts
│   └── revenue_change_final_audit_predictions.csv # Observable 2022→2023 audit export
│
├── data/processed/
│   ├── train_data.csv             # 11,828 company-year observations (2018–2021)
│   └── test_features.csv          # 5,811 rows (2022–2023), no target
│
├── vite-project/                  # React dashboard
│   ├── src/App.jsx                # All chart logic and UI
│   └── package.json
│
├── docs/
│   ├── challenge.md               # Challenge overview
│   ├── challenge_description.md   # Full challenge specification
│   └── data_dictionary.md         # Variable definitions
│
├── images/                        # EDA plots exported from notebook
└── requirements.txt               # Python dependencies
```

---

## Running the Code

### 1. Jupyter Notebook (ML Pipeline)

```bash
# Clone the repo
git clone <your-repo-url>
cd Expert_AI_project

# Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Launch Jupyter and open the notebook
jupyter notebook notebook/revenue_change.ipynb
```

Run all cells top-to-bottom. The notebook is self-contained — it reads from `data/processed/` and writes prediction CSVs to `outputs/`.

> **Python version:** 3.9 or higher recommended.

---

### 2. React Dashboard (Interactive Visualisation)

```bash
cd vite-project

# Install Node dependencies
npm install

# Start the development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser. The app loads `data/processed/train_data.csv` and renders all charts client-side.

To build a static bundle for deployment:

```bash
npm run build    # outputs to vite-project/dist/
npm run preview  # preview the production build locally
```

> **Node version:** 18 or higher recommended.

---

## Outputs

| File | Description |
|---|---|
| `outputs/revenue_change_final_audit_predictions.csv` | 2022→2023 audit: actual vs predicted revenue change with absolute errors |
| `outputs/revenue_change_2024_predictions.csv` | Forward-looking 2024 forecasts from 2023 financial statements (two models: Lasso clean-base + CatBoost) |

Both CSVs include `company_id`, `ateco_sector`, `region`, `legal_form`, predicted revenue change (%), and predicted production value (€).

---

## Performance Targets

| Metric | Minimum | Good | Excellent |
|---|---|---|---|
| MAPE | < 20% | 12–18% | < 12% |

Our evaluation also reports TMAPE (trimmed, denominator-safe), WAPE, SMAPE, directional accuracy, and Spearman ρ, which are more informative than raw MAPE on this target.

---

## Key Design Choices

- **Log-target regression** avoids percentage-error blow-ups near zero while preserving monotonic ordering.
- **Leakage-free temporal splits** — every fold respects chronological order; grouped priors are recomputed inside each training window.
- **Regime classification as a supplement** — five-bucket and three-bucket classifiers are reported alongside regression to make results easier to communicate, but they do not replace the main holdout score.
- **Two-model consensus** — Lasso (clean, interpretable) and CatBoost (nonlinear sensitivity) bracket the uncertainty in final predictions.

---

## Academic Context

This work was completed as part of the Italian Financial Challenge at LUISS University (2024/2025). The dataset covers Italian corporate financial statements and is for educational use only. Do not use these predictions for real financial decisions.
