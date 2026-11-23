import test from "node:test";
import assert from "node:assert/strict";
import references from "./reference-cases.json" with { type: "json" };
import {
  calculate,
  defaults,
  data,
  configurationHash,
  readConfiguration,
} from "../src/model.ts";
import type { Configuration } from "../src/model.ts";

function close(actual: number, expected: number, tolerance = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected}`,
  );
}
for (const reference of references) {
  test(reference.name, () => {
    const result = calculate(reference.config as Configuration);
    reference.expected.prior.forEach((value, i) =>
      close(result.prior[i], value),
    );
    reference.expected.posterior.forEach((value, i) =>
      close(result.posterior[i], value),
    );
    reference.expected.uncertainty.forEach((row, i) =>
      row.forEach((value, j) => {
        close(result.uncertainty[i][j], value);
        close(result.predictive[i][j], value + data.covariances[reference.config.estimator as keyof typeof data.covariances][i][j]);
      }),
    );
    reference.expected.weights.forEach((value, i) =>
      close(result.weights[i], value, 2e-6),
    );
    for (const key of [
      "lambda",
      "marketPremium",
      "marketVolatility",
      "expectedReturn",
      "volatility",
      "sharpe",
    ] as const) {
      close(
        result[key],
        reference.expected[key],
        ["expectedReturn", "volatility", "sharpe"].includes(key) ? 2e-7 : 1e-10,
      );
    }
    close(
      result.weights.reduce((a, b) => a + b, 0),
      1,
    );
    assert.ok(result.weights.every((value) => value >= 0));
    const weightedPrior = result.prior.reduce(
      (sum, value, i) => sum + value * data.weights[i],
      0,
    );
    close(weightedPrior, result.marketPremium);
    if (reference.config.mode === "premium")
      close(weightedPrior, reference.config.premium);
    if (!result.activeCount)
      result.weights.forEach((value, i) => close(value, data.weights[i]));
    // A bound-constrained optimum has equal marginal utility on held assets.
    const marginal = result.weights.map(
      (_, i) =>
        result.posterior[i] -
        result.lambda *
          data.covariances[
            reference.config.estimator as keyof typeof data.covariances
          ][i].reduce((sum, value, j) => sum + value * result.weights[j], 0),
    );
    const held = marginal.filter((_, i) => result.weights[i] > 1e-7);
    held.forEach((value) => close(value, held[0], 1e-8));
    marginal.forEach((value, i) => {
      if (result.weights[i] === 0) assert.ok(value <= held[0] + 1e-8);
    });
  });
}
test("Share settings round-trip and invalid links recover defaults", () => {
  const config = defaults();
  config.mode = "direct";
  config.lambda = 9;
  assert.deepEqual(readConfiguration(configurationHash(config)), config);
  assert.deepEqual(readConfiguration("#settings=broken"), defaults());
  assert.deepEqual(
    readConfiguration(
      "#settings=" + encodeURIComponent('{"mode":"direct","lambda":0}'),
    ),
    defaults(),
  );
});
test("Invalid numerical input fails explicitly", () => {
  for (const lambda of [0, -1, NaN, Infinity]) {
    assert.throws(() => calculate({ ...defaults(), lambda, mode: "direct" }));
  }
});

test("Only the active calibration input affects validity", () => {
  assert.doesNotThrow(() =>
    calculate({ ...defaults(), mode: "direct", premium: NaN }),
  );
  assert.doesNotThrow(() =>
    calculate({ ...defaults(), mode: "premium", lambda: NaN }),
  );
});
