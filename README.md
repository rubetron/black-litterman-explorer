# A Model with a View — Black–Litterman Explorer

A static React/TypeScript/Vite teaching application for Systematically Biased. All interactive calculations run in the browser. Runtime data consists of five annualized covariance matrices, benchmark weights, four fixed view definitions and their editable targets and confidence levels.

## Local development

Use Node.js 24 and pnpm 11.25.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The development server prints its local URL. To test and create a production build:

```sh
pnpm test
pnpm build
pnpm preview
```

## Numerical model

- Assets in fixed order are VTI, IDEV, IEMG, BND and BNDX.
- The October 30, 2026 benchmark weights match the reference notebook.
- The estimation sample contains 1,255 daily USD adjusted ETF returns, November 1, 2021 through October 30, 2026. Each covariance uses that same sample and annualization factor 252.
- Sample covariance uses ddof=1. Scaled-identity Ledoit–Wolf uses scikit-learn. Constant-correlation Ledoit–Wolf uses PyPortfolioOpt's separate implementation.
- Exponentially weighted covariance uses half-lives of 63 and 126 trading observations. Daily retention is `decay = 2**(-1/half_life)` (approximately 0.98905797 and 0.99451394), and smoothing alpha is `1 - decay`. Observation weights are normalized over the same 1,255-return window, centered on their weighted mean, and divided by `1 - sum(normalized_weights**2)` for an unbiased covariance estimate. The result matches pandas `ewm(halflife=h, adjust=True).cov(bias=False)` and is annualized by 252.
- Defaults match the notebook and Part II: 4% market excess premium, tau=0.025, view targets [0.5%, 8%, 1%, 3%] and confidences [75%, 60%, 70%, 50%].
- In premium mode, lambda equals the premium divided by benchmark variance. In direct mode, lambda is the user's input and the implied premium equals lambda times benchmark variance.
- Zero-confidence views are removed. Full-confidence views use exactly zero error variance. The four supported rows are linearly independent, so their joint Gaussian conditioning system remains positive definite even when all four are hard views.
- The view-space posterior uses Cholesky solves from ml-matrix. The portfolio uses the Goldfarb–Idnani constrained QP implementation in quadprog. The risk matrix is the selected original Sigma, as specified in the implementation brief.
- All portfolio allocations are long-only and sum to one. The solver enforces the budget equality directly.
- Sharpe ratios and returns are model-implied. Portfolio summaries evaluate the benchmark and BL allocation against the same posterior mean vector.
- URL fragments encode settings for sharing. Reset restores all defaults.

The interface has two keyboard-accessible tabs: **Assumptions & benchmark** and **Views & portfolio** (the initial tab). The second places four compact view cards on the left and live charts, tables and portfolio summaries on the right. The results remain visible while scrolling through the controls on desktop. On smaller screens the layout stacks. The bottom compares the selected asset-return covariance **Sigma** with **Sigma + Sigma_BL**, the posterior predictive covariance. Matrix entries use annual decimal-return covariance units with six decimals; tooltips retain more precision.

The UI exposes a market-premium input and a direct-lambda input independently. Switching between modes retains both user-entered values. Disabled views retain their target and confidence.

## Validation

`scripts/generate_reference.py` reads the author's cached price data and run metadata, rebuilds all five matrices and generates 60 Python reference scenarios. It verifies matching posterior means and predictive covariances against PyPortfolioOpt and skfolio. The regeneration step is author-side research and is independent of the browser app.

Run it with Python dependencies from the parent project's requirements, or an environment with NumPy, pandas, SciPy, scikit-learn, PyPortfolioOpt and skfolio:

```sh
python scripts/generate_reference.py --prices /path/to/adjusted_daily_prices.csv --metadata /path/to/run_metadata.json
```

The saved source contains only model matrices and numerical test fixtures. The historical input CSV is unnecessary for installation, testing, building or deployment.

The 63 automated tests cover all covariance estimators, both calibration modes, zero views, 50% and 100% confidence, zero confidence, mixed hard/soft views, all four views, zero innovation, binding long-only constraints and multiple lambda values. The two exponentially weighted inputs are independently checked against pandas. Python reference portfolio weights enumerate all 31 possible held-asset sets and check the first-order optimality conditions. Tests also verify the displayed predictive covariance equals Sigma plus posterior mean uncertainty. They also test settings links, invalid inputs, equilibrium identities and constrained first-order conditions.

Tolerances are absolute decimal units. Posterior means and covariance entries use 1e-10, reference portfolio weights use 2e-6, and portfolio statistics use 2e-7. The slightly wider portfolio tolerance accommodates floating-point differences between Python's exhaustive active-set reference and the browser's QP solver. Tests also check weight feasibility and KKT conditions. Python comparison details are recorded in `tests/python-validation.json`.

## GitHub Pages

The contents of this `explorer/` directory are a standalone deployment project. Push these contents to a GitHub repository, with `package.json` at its root. Under **Settings → Pages → Build and deployment**, choose **GitHub Actions**.

The included workflow validates and builds on pull requests, and deploys pushes to `main`. It uploads only `dist/`. Vite's relative asset paths support both project Pages and user Pages URLs. The workflow's deployment job exposes the resulting Pages URL.

No credentials are included in the source. Publishing requires a GitHub repository with access to run Actions and configure Pages. The author’s workbook and private historical exports stay outside this deployment project.

## File guide

- `src/model.ts` contains calibration, posterior calculation, constrained optimization and settings serialization.
- `src/model-data.json` contains static model inputs and provenance.
- `src/main.tsx` and `src/style.css` implement the interface.
- `tests/` contains reference cases and the automated comparisons.
- `.github/workflows/pages.yml` defines GitHub Pages validation and deployment.
