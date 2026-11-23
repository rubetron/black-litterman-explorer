"""Rebuild public covariance inputs and deterministic Python numerical references."""
import argparse
import json
from itertools import combinations
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.linalg import solve
from sklearn.covariance import LedoitWolf
from pypfopt.risk_models import CovarianceShrinkage
from pypfopt.black_litterman import BlackLittermanModel
from skfolio.prior import BasePrior, BlackLitterman, ReturnDistribution

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--prices", type=Path, default=ROOT.parent / "bl_etf_outputs/provider_cache/adjusted_daily_prices.csv")
parser.add_argument("--metadata", type=Path, default=ROOT.parent / "bl_etf_outputs/run_metadata.json")
args = parser.parse_args()
meta = json.loads(args.metadata.read_text())
tickers = meta["ticker_order"]
weights = np.array([meta["benchmark_weights"][ticker] for ticker in tickers])
prices = pd.read_csv(args.prices, index_col=0, parse_dates=True)[tickers].dropna()
daily = prices.pct_change(fill_method=None).dropna()
as_of = pd.Timestamp(meta["covariance_as_of"])
daily = daily.loc[(daily.index > as_of - pd.DateOffset(years=5)) & (daily.index <= as_of)]
shrink = CovarianceShrinkage(daily, returns_data=True, frequency=252)
constant_correlation = shrink.ledoit_wolf(shrinkage_target="constant_correlation").to_numpy()
matrices = {
    "sample": daily.cov().to_numpy() * 252,
    "identity": LedoitWolf().fit(daily).covariance_ * 252,
    "constantCorrelation": constant_correlation,
}
decays = {}
for half_life in (63, 126):
    decay = 2 ** (-1 / half_life)
    # Normalize finite-history observation weights, center on their weighted mean,
    # and apply the unbiased weighted-sample correction.
    observation_weights = decay ** np.arange(len(daily) - 1, -1, -1)
    observation_weights /= observation_weights.sum()
    centered = daily.to_numpy() - observation_weights @ daily.to_numpy()
    covariance = (centered.T * observation_weights) @ centered
    covariance /= 1 - observation_weights @ observation_weights
    pandas_covariance = daily.ewm(halflife=half_life, adjust=True).cov(bias=False).loc[daily.index[-1]].to_numpy()
    np.testing.assert_allclose(covariance, pandas_covariance, atol=1e-14, rtol=0)
    matrices[f"ew{half_life}"] = covariance * 252
    decays[f"ew{half_life}"] = {"halfLife": half_life, "decay": decay,
                                "alpha": 1 - decay}
for covariance in matrices.values():
    assert np.linalg.eigvalsh(covariance).min() > 0
p4 = np.r_[weights[:3] / weights[:3].sum(), -weights[3:] / weights[3:].sum()]
P = np.array([[-1, 1, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 1, -1], p4])
default_lambda = .04 / (weights @ matrices["sample"] @ weights)
default = {"estimator": "sample", "mode": "premium", "premium": .04,
           "lambda": default_lambda, "enabled": [True] * 4,
           "targets": [.005, .08, .01, .03], "confidences": [.75, .60, .70, .50]}
data = {
    "tickers": tickers,
    "exposures": ["US equities", "Developed ex-US equities", "Emerging-market equities",
                  "USD investment-grade bonds", "Hedged non-USD investment-grade bonds"],
    "weights": weights.tolist(), "viewMatrix": P.tolist(), "tau": .025, "defaults": default,
    "covariances": {key: value.tolist() for key, value in matrices.items()},
    "estimation": {"first": str(daily.index.min().date()), "last": str(daily.index.max().date()),
                   "observations": len(daily), "annualization": 252,
                   "benchmarkDate": meta["benchmark_as_of"], "pricesDownloaded": meta["data"]["downloaded_utc"]},
    "shrinkage": {"constantCorrelationIntensity": float(shrink.delta),
                  "identityTarget": "scaled identity", "constantCorrelationTarget": "constant correlation"},
    "exponentialWeighting": {"estimators": decays, "adjust": True, "bias": False,
                             "centering": "exponentially weighted sample mean",
                             "halfLifeUnit": "trading observations"},
}
(ROOT / "src/model-data.json").write_text(json.dumps(data, indent=2) + "\n")

class FixedPrior(BasePrior):
    def __init__(self, mean, covariance):
        self.mean = mean
        self.covariance = covariance
    def fit(self, X, y=None, **params):
        self.return_distribution_ = ReturnDistribution(mu=self.mean, covariance=self.covariance, returns=np.asarray(X))
        return self

references = []
package_errors = []
for estimator in matrices:
    for scenario in ["default", "none-premium", "none-direct", "half", "hard", "mixed",
                     "zero-confidence", "all-hard", "zero-innovation", "binding", "lambda-low", "lambda-high"]:
        config = {**default, "estimator": estimator, "enabled": [True]*4,
                  "targets": list(default["targets"]), "confidences": list(default["confidences"])}
        if scenario == "none-premium": config["enabled"] = [False]*4
        if scenario == "none-direct": config.update(mode="direct", **{"lambda": 7.5}, enabled=[False]*4)
        if scenario in ["half", "hard"]:
            config["enabled"] = [True, False, False, False]
            config["confidences"][0] = .5 if scenario == "half" else 1.
        if scenario == "mixed": config["confidences"] = [1., 0., .7, .5]
        if scenario == "zero-confidence": config["confidences"] = [0.]*4
        if scenario == "all-hard": config["confidences"] = [1.]*4
        if scenario == "binding": config["targets"] = [.02, .12, .02, .03]
        if scenario == "lambda-low": config.update(mode="direct", **{"lambda": .05})
        if scenario == "lambda-high": config.update(mode="direct", **{"lambda": 50.})
        covariance = matrices[estimator]
        market_variance = weights @ covariance @ weights
        lam = config["premium"] / market_variance if config["mode"] == "premium" else config["lambda"]
        pi = lam * covariance @ weights
        if scenario == "zero-innovation": config["targets"] = (P @ pi).tolist()
        active = np.array(config["enabled"]) & (np.array(config["confidences"]) > 0)
        picking = P[active]
        targets = np.array(config["targets"])[active]
        confidence = np.array(config["confidences"])[active]
        omega = .025 * np.diag((1-confidence)/confidence * np.diag(picking @ covariance @ picking.T))
        uncertainty = .025 * covariance
        posterior = pi.copy()
        if active.any():
            cross = uncertainty @ picking.T
            system = picking @ cross + omega
            posterior += cross @ solve(system, targets - picking @ pi, assume_a="pos")
            uncertainty -= cross @ solve(system, cross.T, assume_a="pos")
            py = BlackLittermanModel(cov_matrix=pd.DataFrame(covariance,index=tickers,columns=tickers),
                                    pi=pi, P=picking, Q=targets, tau=.025, omega=omega)
            views = [" ".join(f"{v:+.16f} * {t}" for t,v in zip(tickers,row) if v).lstrip("+")
                     + f" = {q:.16f}" for row,q in zip(picking,targets)]
            sk = BlackLitterman(views=views, prior_estimator=FixedPrior(pi,covariance),
                               view_confidences=confidence, tau=.025, risk_free_rate=0).fit(daily)
            errors = [np.max(np.abs(py.bl_returns().to_numpy()-posterior)),
                      np.max(np.abs(py.bl_cov().to_numpy()-(covariance+uncertainty))),
                      np.max(np.abs(sk.return_distribution_.mu-posterior)),
                      np.max(np.abs(sk.return_distribution_.covariance-(covariance+uncertainty)))]
            assert max(errors) < 1e-10
            package_errors.extend(errors)
        # Independent exact reference: enumerate all 31 possible held-asset sets.
        # The strictly convex five-asset QP has a unique feasible minimum.
        candidates = []
        for size in range(1, len(tickers) + 1):
            for held in combinations(range(len(tickers)), size):
                indices = list(held)
                sub_covariance = covariance[np.ix_(indices, indices)]
                system = np.block([[sub_covariance, np.ones((size, 1))],
                                   [np.ones((1, size)), np.zeros((1, 1))]])
                solution = solve(system, np.r_[posterior[indices] / lam, 1])[:size]
                if solution.min() < -1e-12:
                    continue
                candidate = np.zeros(len(tickers))
                candidate[indices] = np.maximum(solution, 0)
                objective = .5 * candidate @ covariance @ candidate - candidate @ posterior / lam
                candidates.append((objective, candidate))
        _, w = min(candidates, key=lambda candidate: candidate[0])
        gradient = covariance @ w - posterior / lam
        held = w > 1e-10
        np.testing.assert_allclose(gradient[held], gradient[held][0], atol=1e-11, rtol=0)
        assert (gradient[~held] >= gradient[held][0] - 1e-11).all()
        if not active.any(): np.testing.assert_allclose(w, weights, atol=1e-7, rtol=0)
        expected = float(w@posterior)
        vol = float(np.sqrt(w@covariance@w))
        references.append({"name": f"{estimator}/{scenario}", "config": config,
            "expected": {"prior":pi.tolist(),"posterior":posterior.tolist(),
                         "uncertainty":uncertainty.tolist(),"weights":w.tolist(),
                         "lambda":float(lam),"marketPremium":float(lam*market_variance),
                         "marketVolatility":float(np.sqrt(market_variance)),
                         "expectedReturn":expected,"volatility":vol,"sharpe":expected/vol}})
(ROOT / "tests/reference-cases.json").write_text(json.dumps(references,indent=2)+"\n")
(ROOT / "tests/python-validation.json").write_text(json.dumps({
    "cases":len(references),"maximumPackageDiscrepancy":max(package_errors),
    "portfolioReference": "exhaustive active-set enumeration, with KKT verification",
    "exponentialCovarianceReference": "pandas ewm(halflife=h, adjust=True).cov(bias=False)",
    "returnTolerance":1e-10,"weightTolerance":2e-6,"portfolioStatisticTolerance":2e-7,
    "pythonVersions":meta["versions"],
},indent=2)+"\n")
print(f"Generated {len(matrices)} covariance matrices and {len(references)} test cases. Package error {max(package_errors):.2e}.")
