import { Matrix, CholeskyDecomposition } from "ml-matrix";
import qp from "quadprog";
import data from "./model-data.json" with { type: "json" };

export { data };
export type Estimator = keyof typeof data.covariances;
export interface Configuration {
  estimator: Estimator;
  mode: "premium" | "direct";
  premium: number;
  lambda: number;
  enabled: boolean[];
  targets: number[];
  confidences: number[];
}
export const defaults = (): Configuration =>
  structuredClone(data.defaults) as Configuration;
const dot = (a: number[], b: number[]) =>
  a.reduce((sum, value, i) => sum + value * b[i], 0);
const multiply = (a: number[][], v: number[]) => a.map((row) => dot(row, v));
export const estimatorLabels: Record<Estimator, string> = {
  sample: "Sample covariance",
  identity: "Ledoit–Wolf · scaled identity",
  constantCorrelation: "Ledoit–Wolf · constant correlation",
  ew63: "Exponentially weighted · 63-day half-life",
  ew126: "Exponentially weighted · 126-day half-life",
};

export function validate(config: Configuration) {
  if (!Object.hasOwn(data.covariances, config.estimator))
    throw new Error("Choose a supported covariance estimator.");
  if (!["premium", "direct"].includes(config.mode))
    throw new Error("Choose a risk-aversion calibration.");
  if (
    config.mode === "premium" &&
    (!Number.isFinite(config.premium) || config.premium <= 0)
  )
    throw new Error("Enter a positive market premium.");
  if (
    config.mode === "direct" &&
    (!Number.isFinite(config.lambda) || config.lambda <= 0)
  )
    throw new Error("Enter a positive risk-aversion coefficient.");
  if (
    [config.targets, config.confidences, config.enabled].some(
      (values) => values.length !== 4,
    )
  )
    throw new Error("Provide four views.");
  if (config.targets.some((value) => !Number.isFinite(value)))
    throw new Error("Enter a finite annual target for each view.");
  if (
    config.confidences.some(
      (value) => !Number.isFinite(value) || value < 0 || value > 1,
    )
  )
    throw new Error("Confidence must be between 0% and 100%.");
  if (config.enabled.some((value) => typeof value !== "boolean"))
    throw new Error("Each view must be enabled or disabled.");
}

export function optimize(
  mean: number[],
  covariance: number[][],
  lambda: number,
): number[] {
  const n = mean.length;
  // Goldfarb–Idnani QP. Arrays are one-based in this library.
  // Dividing the objective by lambda preserves the optimum and improves conditioning.
  const D = Array.from({ length: n + 1 }, () => Array(n + 1).fill(0));
  const d = Array(n + 1).fill(0);
  const A = Array.from({ length: n + 1 }, () => Array(n + 2).fill(0));
  const b = Array(n + 2).fill(0);
  b[1] = 1; // First constraint is the equality sum(w) = 1.
  for (let i = 0; i < n; i++) {
    d[i + 1] = mean[i] / lambda;
    A[i + 1][1] = 1;
    A[i + 1][i + 2] = 1; // Remaining constraints are w_i >= 0.
    for (let j = 0; j < n; j++) D[i + 1][j + 1] = covariance[i][j];
  }
  const result = qp.solveQP(D, d, A, b, 1);
  if (result.message)
    throw new Error(
      "The constrained optimizer could not solve this configuration.",
    );
  const weights = result.solution.slice(1);
  if (
    weights.some((value) => !Number.isFinite(value) || value < -1e-9) ||
    Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) > 1e-8
  ) {
    throw new Error("The optimizer returned an infeasible allocation.");
  }
  // Remove floating-point residues at binding lower bounds. No normalization is performed.
  return weights.map((value) => (Math.abs(value) < 1e-12 ? 0 : value));
}

export function calculate(config: Configuration) {
  validate(config);
  const covariance = data.covariances[config.estimator];
  const Sigma = new Matrix(covariance);
  const marketVariance = dot(data.weights, multiply(covariance, data.weights));
  const lambda =
    config.mode === "premium" ? config.premium / marketVariance : config.lambda;
  const marketPremium = lambda * marketVariance;
  const prior = multiply(covariance, data.weights).map(
    (value) => value * lambda,
  );
  const implied = multiply(data.viewMatrix, prior);
  const innovation = config.targets.map((value, i) => value - implied[i]);
  const active = data.viewMatrix
    .map((_, i) => i)
    .filter((i) => config.enabled[i] && config.confidences[i] > 0);
  let posterior = [...prior];
  let uncertainty = Sigma.clone().mul(data.tau);
  if (active.length) {
    const P = new Matrix(active.map((i) => data.viewMatrix[i]));
    const cross = uncertainty.mmul(P.transpose());
    const system = P.mmul(cross);
    active.forEach((index, i) => {
      const variance = dot(
        data.viewMatrix[index],
        multiply(covariance, data.viewMatrix[index]),
      );
      const confidence = config.confidences[index];
      const omega = ((data.tau * (1 - confidence)) / confidence) * variance;
      system.set(i, i, system.get(i, i) + omega);
    });
    const symmetricSystem = system.clone().add(system.transpose()).mul(0.5);
    const factor = new CholeskyDecomposition(symmetricSystem);
    const correction = cross.mmul(
      factor.solve(Matrix.columnVector(active.map((i) => innovation[i]))),
    );
    posterior = prior.map((value, i) => value + correction.get(i, 0));
    uncertainty = uncertainty.sub(cross.mmul(factor.solve(cross.transpose())));
  }
  // Symmetrize numerical round-off in the conditional covariance.
  uncertainty = uncertainty.add(uncertainty.transpose()).mul(0.5);
  const predictive = Sigma.add(uncertainty);
  if (![...posterior, lambda, marketPremium].every(Number.isFinite)) {
    throw new Error(
      "These inputs exceed numerical precision. Please use smaller values.",
    );
  }
  const weights = optimize(posterior, covariance, lambda);
  const activeWeights = weights.map((value, i) => value - data.weights[i]);
  const expectedReturn = dot(weights, posterior);
  const volatility = Math.sqrt(dot(weights, multiply(covariance, weights)));
  const benchmarkReturn = dot(data.weights, posterior);
  const equityWeight = weights
    .slice(0, 3)
    .reduce((sum, value) => sum + value, 0);
  const overweight = activeWeights.indexOf(Math.max(...activeWeights));
  const underweight = activeWeights.indexOf(Math.min(...activeWeights));
  if (
    ![...posterior, lambda, expectedReturn, volatility].every(Number.isFinite)
  ) {
    throw new Error(
      "These inputs exceed numerical precision. Please use smaller values.",
    );
  }
  return {
    prior,
    posterior,
    uncertainty: uncertainty.to2DArray(),
    predictive: predictive.to2DArray(),
    weights,
    activeWeights,
    implied,
    innovation,
    activeCount: active.length,
    lambda,
    marketPremium,
    marketVolatility: Math.sqrt(marketVariance),
    expectedReturn,
    volatility,
    sharpe: expectedReturn / volatility,
    benchmarkReturn,
    equityWeight,
    bondWeight: 1 - equityWeight,
    overweight,
    underweight,
    trackingError: Math.sqrt(
      Math.max(0, dot(activeWeights, multiply(covariance, activeWeights))),
    ),
  };
}
export type ModelResult = ReturnType<typeof calculate>;

export function readConfiguration(hash: string): Configuration {
  try {
    if (!hash.startsWith("#settings=")) return defaults();
    const parsed = JSON.parse(
      decodeURIComponent(hash.slice("#settings=".length)),
    );
    const config = { ...defaults(), ...parsed };
    validate(config);
    return config;
  } catch {
    return defaults();
  }
}
export function configurationHash(config: Configuration) {
  return "#settings=" + encodeURIComponent(JSON.stringify(config));
}
