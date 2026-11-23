import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Info,
  RotateCcw,
  Share2,
  SlidersHorizontal,
} from "lucide-react";
import {
  calculate,
  data,
  defaults,
  estimatorLabels,
  configurationHash,
  readConfiguration,
} from "./model";
import type { Configuration, Estimator, ModelResult } from "./model";
import logo from "./assets/systematically-biased-logo.png";
import "./style.css";

const percent = (value: number, digits = 2) =>
  (Math.abs(value) < 1e-10 ? 0 : value * 100).toFixed(digits) + "%";
const points = (value: number) =>
  (value > 1e-10 ? "+" : "") +
  (Math.abs(value) < 1e-10 ? 0 : value * 100).toFixed(2) +
  " pp";
const viewNames = [
  "Developed markets over the US",
  "Emerging-market excess return",
  "USD over international bonds",
  "Equities over bonds",
];
const viewDescriptions = [
  "IDEV − VTI",
  "IEMG",
  "BND − BNDX",
  "Benchmark-weighted sleeves",
];
const colors = ["#273e49", "#47917e", "#91b5a9", "#b47d53", "#d0ad86"];

function App() {
  const [config, setConfig] = useState<Configuration>(() =>
    readConfiguration(window.location.hash),
  );
  const [tab, setTab] = useState<"assumptions" | "explore">("explore");
  const [shared, setShared] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const evaluation = useMemo(() => {
    try {
      return { result: calculate(config), error: "" };
    } catch (error) {
      return {
        result: null,
        error:
          error instanceof Error
            ? error.message
            : "Unable to calculate this configuration.",
      };
    }
  }, [config]);
  const result = evaluation.result;
  function update<K extends keyof Configuration>(
    key: K,
    value: Configuration[K],
  ) {
    setConfig((old) => ({ ...old, [key]: value }));
    setShared(false);
    if (window.location.hash)
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
  }
  function updateView(
    key: "targets" | "confidences" | "enabled",
    i: number,
    value: number | boolean,
  ) {
    setConfig((old) => ({
      ...old,
      [key]: old[key].map((current, j) => (j === i ? value : current)),
    }));
    setShared(false);
    if (window.location.hash)
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
  }
  async function share() {
    if (!result) return;
    const url = new URL(window.location.href);
    url.hash = configurationHash(config);
    window.history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url.href);
      setShared(true);
    } catch {
      setShared(true);
    } // The address bar always contains the shareable URL.
  }
  function reset() {
    setConfig(defaults());
    setShared(false);
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  }
  return (
    <>
      <header className="masthead">
        <a href="https://systematicallybiased.substack.com/" className="brand">
          <img className="brand-logo" src={logo} alt="Systematically Biased" width="891" height="687" />
        </a>
        <a
          className="article-link"
          href="https://systematicallybiased.substack.com/p/689d21f2-a531-429f-944e-598a85563f53"
          target="_blank"
          rel="noreferrer"
        >
          Read the article <ArrowUpRight size={16} />
        </a>
      </header>
      <main>
        <section className="intro">
          <div>
            <h1 className="explorer-title">The Black–Litterman Explorer</h1>
            <p className="lede">
              Black–Litterman starts with market-implied expected returns and
              updates them using your investment views and confidence levels.
              Adjust the inputs to see how expected returns and long-only
              portfolio allocations change relative to the market benchmark.
            </p>
          </div>
          <div className="intro-actions">
            <button className="quiet-button" onClick={reset}>
              <RotateCcw size={16} /> Reset
            </button>
            <button className="share-button" disabled={!result} onClick={share}>
              {shared ? <Check size={16} /> : <Share2 size={16} />}
              {shared ? "Link ready in address bar" : "Share settings"}
            </button>
          </div>
        </section>

        <div className="app-tabs" role="tablist" aria-label="Explorer sections">
          {(["assumptions", "explore"] as const).map((name) => (
            <button key={name} id={"tab-" + name} role="tab"
              aria-selected={tab === name} aria-controls={"panel-" + name}
              tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)}
              onKeyDown={(event) => {
                if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  const next = event.key === "Home" ? "assumptions" : event.key === "End" ? "explore" : name === "assumptions" ? "explore" : "assumptions";
                  setTab(next);
                  document.getElementById("tab-" + next)?.focus();
                }
              }}>
              {name === "assumptions" ? "Assumptions & benchmark" : "Views & portfolio"}
            </button>
          ))}
        </div>
        {evaluation.error && <div className="error-message" role="alert">{evaluation.error}</div>}
        <div id="panel-assumptions" role="tabpanel" aria-labelledby="tab-assumptions" hidden={tab !== "assumptions"}>
        <section
          className="assumptions panel"
          aria-labelledby="assumptions-title"
        >
          <div className="assumption-controls">
            <div className="section-title">
              <SlidersHorizontal size={19} />
              <h2 id="assumptions-title">Model assumptions</h2>
            </div>
            <label className="field-label" htmlFor="covariance">
              Covariance estimator
            </label>
            <div className="select-wrap">
              <select
                id="covariance"
                value={config.estimator}
                onChange={(e) =>
                  update("estimator", e.target.value as Estimator)
                }
              >
                {Object.entries(estimatorLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </div>
            <div className="segmented" aria-label="Risk-aversion calibration">
              {(["premium", "direct"] as const).map((mode) => (
                <button
                  key={mode}
                  aria-pressed={config.mode === mode}
                  onClick={() => update("mode", mode)}
                >
                  {mode === "premium"
                    ? "Infer risk aversion"
                    : "Set risk aversion"}
                </button>
              ))}
            </div>
            {config.mode === "premium" ? (
              <div className="calibration-input">
                <div>
                  <label htmlFor="premium" className="field-label">
                    Market excess-return assumption
                  </label>
                  <p className="hint">Annual expected premium over cash</p>
                </div>
                <div className="number-with-unit">
                  <input
                    id="premium"
                    type="number"
                    min="0.01"
                    step=".25"
                    value={
                      Number.isFinite(config.premium)
                        ? Number((config.premium * 100).toFixed(8))
                        : ""
                    }
                    onChange={(e) =>
                      update(
                        "premium",
                        e.target.value === ""
                          ? NaN
                          : Number(e.target.value) / 100,
                      )
                    }
                  />
                  <span>%</span>
                </div>
              </div>
            ) : (
              <div className="calibration-input">
                <div>
                  <label htmlFor="lambda" className="field-label">
                    Risk-aversion coefficient λ
                  </label>
                  <p className="hint">
                    Higher values mean greater risk aversion
                  </p>
                </div>
                <div className="number-with-unit">
                  <input
                    id="lambda"
                    type="number"
                    min="0"
                    step=".1"
                    value={Number.isFinite(config.lambda) ? config.lambda : ""}
                    onChange={(e) =>
                      update(
                        "lambda",
                        e.target.value === "" ? NaN : Number(e.target.value),
                      )
                    }
                  />
                </div>
              </div>
            )}
            <div className="market-metrics" aria-live="polite">
              <div>
                <span>Risk aversion λ</span>
                <strong>{result ? result.lambda.toFixed(3) : "—"}</strong>
              </div>
              <div>
                <span>Market volatility</span>
                <strong>
                  {result ? percent(result.marketVolatility) : "—"}
                </strong>
              </div>
              <div>
                <span>
                  {config.mode === "premium"
                    ? "Assumed premium"
                    : "Implied premium"}
                </span>
                <strong>{result ? percent(result.marketPremium) : "—"}</strong>
              </div>
            </div>
          </div>
          <div className="benchmark">
            <div className="benchmark-header">
              <h3>Market benchmark</h3>
              <span>30 OCT 2026</span>
            </div>
            <div
              className="benchmark-strip"
              role="img"
              aria-label="Market benchmark allocation"
            >
              {data.weights.map((weight, i) => (
                <div
                  key={i}
                  style={{ width: percent(weight, 5), background: colors[i] }}
                  title={data.tickers[i] + " " + percent(weight)}
                />
              ))}
            </div>
            <table className="benchmark-table">
              <thead>
                <tr>
                  <th>ETF / exposure</th>
                  <th>Weight</th>
                </tr>
              </thead>
              <tbody>
                {data.tickers.map((ticker, i) => (
                  <tr key={ticker}>
                    <td>
                      <span
                        className="asset-swatch"
                        style={{ background: colors[i] }}
                      />
                      <strong>{ticker}</strong>
                      <span className="exposure">{data.exposures[i]}</span>
                    </td>
                    <td>{percent(data.weights[i])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="source-note">
              Five-year covariance ·{" "}
              {data.estimation.observations.toLocaleString()} daily observations
              <br />1 Nov 2021 – 30 Oct 2026 · Annualized × 252 · τ = 0.025
            </p>
          </div>
        </section>

        </div>
        <div id="panel-explore" role="tabpanel" aria-labelledby="tab-explore" hidden={tab !== "explore"}>
        <div className="current-assumptions">
          <span>{estimatorLabels[config.estimator]}</span>
          <span>λ {result ? result.lambda.toFixed(3) : "—"}</span>
          <span>{config.mode === "premium" ? "Assumed" : "Implied"} market premium {result ? percent(result.marketPremium) : "—"}</span>
          <button onClick={() => setTab("assumptions")}>Edit assumptions</button>
        </div>
        <div className="explorer-workspace">
        <section aria-labelledby="views-title" className="views-section">
          <div className="section-heading">
            <div>
              <h2 id="views-title">What do you believe?</h2>
              <p>
                Annual targets and confidence
              </p>
            </div>
            <span className="active-count">
              {result?.activeCount ?? "—"} / 4 active views
            </span>
          </div>
          <div className="views-grid">
            {viewNames.map((name, i) => {
              const active = config.enabled[i] && config.confidences[i] > 0;
              const innovation = result?.innovation[i] ?? 0;
              const stance = !result
                ? "Awaiting valid inputs"
                : !active
                  ? "Omitted from update"
                  : Math.abs(innovation) < 1e-8
                    ? "In line with equilibrium"
                    : innovation > 0
                      ? "Above equilibrium"
                      : "Below equilibrium";
              return (
                <article
                  key={name}
                  className={
                    "view-card " + (!config.enabled[i] ? "disabled" : "")
                  }
                >
                  <div className="view-header">
                    <div>
                      <h3>{name}</h3>
                      <p>{viewDescriptions[i]}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={config.enabled[i]}
                      aria-label={"Enable " + name}
                      className="toggle"
                      onClick={() =>
                        updateView("enabled", i, !config.enabled[i])
                      }
                    >
                      <span />
                    </button>
                  </div>
                  <div className="view-inputs">
                  <div className="target-row">
                    <label htmlFor={"view-" + i}>
                      {i === 1 ? "Excess return" : "Outperformance"}
                    </label>
                    <div className="number-with-unit">
                      <input
                        id={"view-" + i}
                        type="number"
                        step=".25"
                        disabled={!config.enabled[i]}
                        value={
                          Number.isFinite(config.targets[i])
                            ? Number((config.targets[i] * 100).toFixed(8))
                            : ""
                        }
                        onChange={(e) =>
                          updateView(
                            "targets",
                            i,
                            e.target.value === ""
                              ? NaN
                              : Number(e.target.value) / 100,
                          )
                        }
                      />
                      <span>%</span>
                    </div>
                  </div>
                  <div className="confidence-control">
                  <div className="confidence-label">
                    <label htmlFor={"confidence-" + i}>Confidence</label>
                    <output htmlFor={"confidence-" + i}>
                      {percent(config.confidences[i], 0)}
                    </output>
                  </div>
                  <input
                    id={"confidence-" + i}
                    className="slider"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    disabled={!config.enabled[i]}
                    value={config.confidences[i] * 100}
                    onChange={(e) =>
                      updateView("confidences", i, Number(e.target.value) / 100)
                    }
                    style={
                      {
                        "--progress": percent(config.confidences[i]),
                      } as React.CSSProperties
                    }
                  />
                  </div>
                  </div>
                  <div className="view-comparison">
                    <div>
                      <span>Equilibrium</span>
                      <strong>
                        {result ? percent(result.implied[i]) : "—"}
                      </strong>
                    </div>
                    <div>
                      <span>Innovation</span>
                      <strong title={stance} className={active && result ? innovation > 0 ? "innovation-positive" : "innovation-negative" : ""}>{result ? points(innovation) : "—"}</strong>
                    </div>

                  </div>
                </article>
              );
            })}
          </div>
          <p className="help-line">
            <Info size={14} /> Confidence calibrates an isolated view’s
            uncertainty. Joint views interact. At 0% the view is omitted; at
            100% its expected-return target is imposed exactly.
          </p>
        </section>

        {result && <Results result={result} />}
        </div>
        {result && <CovarianceComparison covariance={data.covariances[config.estimator]} predictive={result.predictive} />}
        </div>
        <section className="methodology">
          <button
            className="method-toggle"
            aria-expanded={methodOpen}
            onClick={() => setMethodOpen(!methodOpen)}
          >
            <Info size={16} /> Calculation notes <ChevronDown size={16} />
          </button>
          {methodOpen && (
            <div className="method-content">
              <p>
                The prior is π = λΣwₘₖₜ. In inferred mode, λ equals the market
                excess premium divided by its variance. In direct mode the
                implied premium is λwₘₖₜᵀΣwₘₖₜ.
              </p>
              <p>
                The posterior combines active views jointly with Idzorek
                uncertainty Ωₖₖ = τ(1 − cₖ)/cₖ × pₖΣpₖᵀ. Disabled and
                zero-confidence views are omitted. Full-confidence views have
                zero error variance. The conditional update is solved by
                Cholesky factorization.
              </p>
              <p>
                The long-only, fully invested portfolio maximizes wᵀμ − λwᵀΣw/2.
                A constrained quadratic-programming solver uses Σ as the risk
                matrix. Posterior mean uncertainty is Σ_BL; predictive return
                covariance is Σ + Σ_BL. Higher confidence can produce
                concentrated portfolios and zero holdings.
              </p>
              <p>
                All displayed returns, risk and Sharpe ratios are model-implied
                annual excess-return quantities. Sharpe is posterior portfolio
                excess return divided by volatility. The benchmark’s summary
                uses the same posterior expected returns as the BL portfolio.
              </p>
              <p>
                Static inputs use Yahoo Finance adjusted USD ETF prices over the
                same five-year window for each estimator. Scaled-identity
                Ledoit–Wolf uses scikit-learn. Constant-correlation Ledoit–Wolf
                uses PyPortfolioOpt’s verified implementation. Exponentially weighted
                estimates use 63- or 126-trading-day half-lives, normalized finite-history
                weights, a weighted sample mean and an unbiased covariance correction.
                Daily decay is 2^(−1 / half-life); all estimates are annualized × 252.
                Benchmark weights
                use Bloomberg index market values as of October 30, 2026.
                Weights and τ are fixed in this explorer.
              </p>
              <p>
                <a
                  href="https://pyportfolioopt.readthedocs.io/en/latest/BlackLitterman.html"
                  target="_blank"
                  rel="noreferrer"
                >
                  PyPortfolioOpt documentation
                </a>{" "}
                ·{" "}
                <a
                  href="https://skfolio.org/generated/skfolio.prior.BlackLitterman.html"
                  target="_blank"
                  rel="noreferrer"
                >
                  skfolio documentation
                </a>
              </p>
            </div>
          )}
        </section>
      </main>
      <footer>
        <span>Systematically Biased</span>
        <span>A Model with a View · Educational portfolio explorer</span>
      </footer>
    </>
  );
}

function ReturnChart({ result }: { result: ModelResult }) {
  const values = [...result.prior, ...result.posterior].map(
    (value) => value * 100,
  );
  const min = Math.min(0, ...values);
  const max = Math.max(0.01, ...values);
  const span = max - min;
  const y = (value: number) => 207 - ((value * 100 - min) / span) * 165;
  const base = y(0);
  return (
    <svg
      className="chart"
      viewBox="0 0 490 265"
      role="img"
      aria-labelledby="return-chart-title"
    >
      <title id="return-chart-title">
        Equilibrium and posterior annual excess returns
      </title>
      {[0, 0.25, 0.5, 0.75, 1].map((step) => {
        const value = min + step * span;
        const yy = 207 - step * 165;
        return (
          <g key={step}>
            <line x1="48" x2="480" y1={yy} y2={yy} className="grid-line" />
            <text x="39" y={yy + 4} textAnchor="end" className="axis-label">
              {value.toFixed(1)}%
            </text>
          </g>
        );
      })}
      {data.tickers.map((ticker, i) => (
        <g key={ticker}>
          {[result.prior[i], result.posterior[i]].map((value, j) => (
            <rect
              key={j}
              x={64 + i * 84 + j * 23}
              y={Math.min(y(value), base)}
              width="20"
              height={Math.max(0.5, Math.abs(base - y(value)))}
              rx="2"
              fill={j ? "#367c69" : "#b3c1c6"}
            >
              <title>
                {ticker} {j ? "posterior" : "prior"} {percent(value)}
              </title>
            </rect>
          ))}
          <text
            x={85 + i * 84}
            y="236"
            textAnchor="middle"
            className="chart-ticker"
          >
            {ticker}
          </text>
        </g>
      ))}
    </svg>
  );
}
function AllocationChart({ result }: { result: ModelResult }) {
  const max = Math.max(0.5, ...result.weights, ...data.weights);
  const x = (value: number) => (value / max) * 300;
  return (
    <svg
      className="chart"
      viewBox="0 0 490 265"
      role="img"
      aria-labelledby="allocation-chart-title"
    >
      <title id="allocation-chart-title">
        Market benchmark and long-only Black–Litterman allocations
      </title>
      {[0, 0.25, 0.5, 0.75, 1].map((step) => (
        <g key={step}>
          <line
            x1={70 + step * 300}
            x2={70 + step * 300}
            y1="15"
            y2="232"
            className="grid-line"
          />
          <text
            x={70 + step * 300}
            y="253"
            textAnchor="middle"
            className="axis-label"
          >
            {(max * step * 100).toFixed(0)}%
          </text>
        </g>
      ))}
      {data.tickers.map((ticker, i) => (
        <g key={ticker}>
          <text x="0" y={40 + i * 43} className="chart-ticker">
            {ticker}
          </text>
          <rect
            x="70"
            y={23 + i * 43}
            width={x(data.weights[i])}
            height="10"
            rx="2"
            fill="#b3c1c6"
          >
            <title>
              {ticker} benchmark {percent(data.weights[i])}
            </title>
          </rect>
          <rect
            x="70"
            y={36 + i * 43}
            width={x(result.weights[i])}
            height="10"
            rx="2"
            fill="#367c69"
          >
            <title>
              {ticker} BL {percent(result.weights[i])}, active{" "}
              {points(result.activeWeights[i])}
            </title>
          </rect>
          <text
            x="483"
            y={43 + i * 43}
            textAnchor="end"
            className={
              "active-label " + (result.activeWeights[i] < -1e-8 ? "down" : "")
            }
          >
            {points(result.activeWeights[i])}
          </text>
        </g>
      ))}
    </svg>
  );
}
function CovarianceComparison({ covariance, predictive }: { covariance: number[][]; predictive: number[][] }) {
  return (
    <section className="covariance-section" aria-labelledby="covariance-title">
      <div className="section-heading"><div>
        <h2 id="covariance-title">Return covariance</h2>
        <p>Annualized covariance in decimal-return units. Portfolio optimization uses Σ.</p>
      </div></div>
      <div className="covariance-grid">
        <CovarianceTable title="Asset-return covariance · Σ" description="Selected estimate before incorporating views." matrix={covariance} />
        <CovarianceTable title="Posterior predictive covariance · Σ + Σ_BL" description="Return covariance plus remaining uncertainty about expected returns." matrix={predictive} />
      </div>
      <p className="help-line"><Info size={14} />Σ_BL is posterior uncertainty about expected returns. The right matrix adds it to Σ; their difference is Σ_BL. With no active views, Σ_BL = τΣ.</p>
    </section>
  );
}
function CovarianceTable({ title, description, matrix }: { title: string; description: string; matrix: number[][] }) {
  return <article className="panel covariance-panel">
    <h3>{title}</h3><p className="hint">{description}</p>
    <div className="matrix-scroll" tabIndex={0} role="region" aria-label={title}>
      <table className="covariance-table"><caption>{title} · Annualized decimal units</caption>
        <thead><tr><th scope="col">ETF</th>{data.tickers.map(ticker => <th scope="col" key={ticker}>{ticker}</th>)}</tr></thead>
        <tbody>{data.tickers.map((ticker, i) => <tr key={ticker}><th scope="row">{ticker}</th>
          {matrix[i].map((value, j) => <td key={j} title={value.toPrecision(12)} style={{background: `rgba(54, 124, 105, ${Math.min(.25, Math.abs(value) * 5)})`}}>{value.toFixed(6)}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </article>;
}

function Results({ result }: { result: ModelResult }) {
  const benchmarkEquity = data.weights
    .slice(0, 3)
    .reduce((sum, value) => sum + value, 0);
  const unchanged = result.activeWeights.every(
    (value) => Math.abs(value) < 1e-8,
  );
  return (
    <section className="results" aria-labelledby="results-title">
      <div className="section-heading">
        <div>
          <h2 id="results-title">Portfolio impact</h2>
          <p>
            {result.activeCount
              ? "Joint Black–Litterman update · Long-only, fully invested"
              : "With no active views, the optimized allocation reproduces the market benchmark."}
          </p>
        </div>
        <span className="live-label">Updates as you explore</span>
      </div>
      <div className="results-grid">
        <article className="panel chart-panel">
          <h3>Expected excess returns</h3>
          <div className="chart-legend">
            <span>
              <i className="prior-key" />
              Equilibrium
            </span>
            <span>
              <i className="posterior-key" />
              BL posterior
            </span>
          </div>
          <ReturnChart result={result} />
          <table className="results-table">
            <thead>
              <tr>
                <th>ETF</th>
                <th>Equilibrium</th>
                <th>Posterior</th>
              </tr>
            </thead>
            <tbody>
              {data.tickers.map((ticker, i) => (
                <tr key={ticker}>
                  <th>{ticker}</th>
                  <td>{percent(result.prior[i])}</td>
                  <td>{percent(result.posterior[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
        <article className="panel chart-panel">
          <h3>Portfolio allocation</h3>
          <div className="chart-legend">
            <span>
              <i className="prior-key" />
              Market benchmark
            </span>
            <span>
              <i className="posterior-key" />
              Long-only BL
            </span>
          </div>
          <AllocationChart result={result} />
          <table className="results-table">
            <thead>
              <tr>
                <th>ETF</th>
                <th>Market</th>
                <th>BL</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {data.tickers.map((ticker, i) => (
                <tr key={ticker}>
                  <th>{ticker}</th>
                  <td>{percent(data.weights[i])}</td>
                  <td>{percent(result.weights[i])}</td>
                  <td>{points(result.activeWeights[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </div>
      <div className="summary-panel">
        <div className="summary-heading">
          <h3>Portfolio summary</h3>
          <span>Model-implied · Annual</span>
        </div>
        <div className="summary-metrics">
          <div>
            <span>Expected excess return</span>
            <strong>{percent(result.expectedReturn)}</strong>
            <small>Market {percent(result.benchmarkReturn)}</small>
          </div>
          <div>
            <span>Volatility</span>
            <strong>{percent(result.volatility)}</strong>
            <small>Market {percent(result.marketVolatility)}</small>
          </div>
          <div>
            <span>Sharpe ratio</span>
            <strong>{result.sharpe.toFixed(2)}</strong>
            <small>
              Market{" "}
              {(result.benchmarkReturn / result.marketVolatility).toFixed(2)}
            </small>
          </div>
          <div>
            <span>Equities / bonds</span>
            <strong>
              {percent(result.equityWeight, 1)} <em>/</em>{" "}
              {percent(result.bondWeight, 1)}
            </strong>
            <small>
              Market {percent(benchmarkEquity, 1)} /{" "}
              {percent(1 - benchmarkEquity, 1)}
            </small>
          </div>
        </div>
        <div className="active-summary">
          <span>
            Largest overweight{" "}
            <strong>
              {unchanged
                ? "None"
                : data.tickers[result.overweight] +
                  " " +
                  points(result.activeWeights[result.overweight])}
            </strong>
          </span>
          <span>
            Largest underweight{" "}
            <strong>
              {unchanged
                ? "None"
                : data.tickers[result.underweight] +
                  " " +
                  points(result.activeWeights[result.underweight])}
            </strong>
          </span>
          <span>
            Fully invested{" "}
            <strong>
              {percent(
                result.weights.reduce((a, b) => a + b, 0),
                0,
              )}
            </strong>
          </span>
        </div>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
