/**
 * flakyguard core: flaky-test evidence tracking across CI runs.
 *
 *   analyzeTestFlakiness(runs, minRuns, quarantineThreshold) -> analysis
 *
 * Behaviour:
 * - Each distinct test name is aggregated across all runs:
 *   appearances counts the runs that contain it, and passes,
 *   failures, and skips count its outcomes in those runs.
 * - evidence_runs is passes + failures; a skipped outcome is
 *   recorded but never counts as evidence.
 * - A test is "insufficient_data" while its evidence_runs is
 *   below min_runs (default 2). With enough evidence it is
 *   "stable_pass" when it never failed, "stable_fail" when
 *   it never passed, and "flaky" when it did both.
 * - flakiness_rate is min(passes, failures) / evidence_runs,
 *   or 0 when there is no evidence, rounded to 4 decimal
 *   places. A perfectly split history rates 0.5; a test that
 *   only ever passes or only ever fails rates 0.
 * - The quarantine list holds the flaky tests whose
 *   flakiness_rate meets the threshold (default 0.5), sorted
 *   by rate descending with test-name-ascending ties.
 * - The verdict is "quarantine_recommended" when the
 *   quarantine list is non-empty, otherwise "clean".
 *
 * Validation is strict and path-naming: any malformed input
 * throws an Error naming the offending path (for example
 * "runs[0].results[1].status must be one of passed, failed,
 * skipped") and no partial result is produced.
 */
import type {
  Classification,
  FlakinessResult,
  FlakyRun,
  QuarantineEntry,
  TestResult,
  TestStats,
  TestStatus,
} from "./types.js";

export const VERSION = "0.1.0";

const STATUSES: readonly TestStatus[] = ["passed", "failed", "skipped"];

function round4(value: number): number {
  const rounded = Math.round(value * 10000) / 10000;
  return rounded === 0 ? 0 : rounded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateResult(raw: unknown, path: string): TestResult {
  if (!isRecord(raw)) throw new Error(`${path} must be an object`);
  if (raw.test === undefined) throw new Error(`${path}.test is required`);
  if (typeof raw.test !== "string" || raw.test.length === 0) {
    throw new Error(`${path}.test must be a non-empty string`);
  }
  if (raw.status === undefined) throw new Error(`${path}.status is required`);
  if (
    typeof raw.status !== "string" ||
    !(STATUSES as readonly string[]).includes(raw.status)
  ) {
    throw new Error(`${path}.status must be one of passed, failed, skipped`);
  }
  return { test: raw.test, status: raw.status as TestStatus };
}

function validateRun(raw: unknown, index: number): FlakyRun {
  const path = `runs[${index}]`;
  if (!isRecord(raw)) throw new Error(`${path} must be an object`);
  if (raw.run_id === undefined) throw new Error(`${path}.run_id is required`);
  if (typeof raw.run_id !== "string" || raw.run_id.length === 0) {
    throw new Error(`${path}.run_id must be a non-empty string`);
  }
  if (raw.results === undefined) throw new Error(`${path}.results is required`);
  if (!Array.isArray(raw.results) || raw.results.length === 0) {
    throw new Error(`${path}.results must be a non-empty array`);
  }
  const results = raw.results.map((r, j) =>
    validateResult(r, `${path}.results[${j}]`),
  );
  const seen = new Set<string>();
  for (let j = 0; j < results.length; j++) {
    const name = results[j].test;
    if (seen.has(name)) {
      throw new Error(
        `${path}.results[${j}].test duplicates test '${name}' in the same run`,
      );
    }
    seen.add(name);
  }
  return { run_id: raw.run_id, results };
}

function validateArgs(
  runs: unknown,
  minRuns: unknown,
  quarantineThreshold: unknown,
): { runs: FlakyRun[]; minRuns: number; threshold: number } {
  if (runs === undefined) throw new Error("runs is required");
  if (!Array.isArray(runs) || runs.length === 0) {
    throw new Error("runs must be a non-empty array");
  }
  const validated = runs.map((r, i) => validateRun(r, i));

  let min = 2;
  if (minRuns !== undefined) {
    if (typeof minRuns !== "number" || !Number.isInteger(minRuns)) {
      throw new Error("min_runs must be an integer");
    }
    if (minRuns < 1) {
      throw new Error("min_runs must be >= 1");
    }
    min = minRuns;
  }

  let threshold = 0.5;
  if (quarantineThreshold !== undefined) {
    if (
      typeof quarantineThreshold !== "number" ||
      !Number.isFinite(quarantineThreshold)
    ) {
      throw new Error("quarantine_threshold must be a number");
    }
    if (quarantineThreshold < 0 || quarantineThreshold > 1) {
      throw new Error("quarantine_threshold must be between 0 and 1");
    }
    threshold = quarantineThreshold;
  }

  return { runs: validated, minRuns: min, threshold };
}

/** Analyze test flakiness across the supplied runs. */
export function analyzeTestFlakiness(
  runs: unknown,
  minRuns?: unknown,
  quarantineThreshold?: unknown,
): FlakinessResult {
  const {
    runs: validRuns,
    minRuns: min,
    threshold,
  } = validateArgs(runs, minRuns, quarantineThreshold);

  interface Acc {
    appearances: number;
    passes: number;
    failures: number;
    skips: number;
  }
  const byTest = new Map<string, Acc>();
  for (const run of validRuns) {
    for (const result of run.results) {
      let acc = byTest.get(result.test);
      if (!acc) {
        acc = { appearances: 0, passes: 0, failures: 0, skips: 0 };
        byTest.set(result.test, acc);
      }
      acc.appearances += 1;
      if (result.status === "passed") acc.passes += 1;
      else if (result.status === "failed") acc.failures += 1;
      else acc.skips += 1;
    }
  }

  const tests: TestStats[] = [...byTest.entries()]
    .map(([test, acc]) => {
      const evidence = acc.passes + acc.failures;
      let classification: Classification;
      if (evidence < min) classification = "insufficient_data";
      else if (acc.failures === 0) classification = "stable_pass";
      else if (acc.passes === 0) classification = "stable_fail";
      else classification = "flaky";
      return {
        test,
        appearances: acc.appearances,
        passes: acc.passes,
        failures: acc.failures,
        skips: acc.skips,
        evidence_runs: evidence,
        classification,
        flakiness_rate:
          evidence === 0 ? 0 : round4(Math.min(acc.passes, acc.failures) / evidence),
      };
    })
    .sort((a, b) => (a.test < b.test ? -1 : a.test > b.test ? 1 : 0));

  const quarantine: QuarantineEntry[] = tests
    .filter((t) => t.classification === "flaky" && t.flakiness_rate >= threshold)
    .map((t) => ({
      test: t.test,
      passes: t.passes,
      failures: t.failures,
      flakiness_rate: t.flakiness_rate,
    }))
    .sort(
      (a, b) =>
        b.flakiness_rate - a.flakiness_rate ||
        (a.test < b.test ? -1 : a.test > b.test ? 1 : 0),
    );

  const summary = {
    stable_pass: 0,
    stable_fail: 0,
    flaky: 0,
    insufficient_data: 0,
  };
  for (const t of tests) summary[t.classification] += 1;

  return {
    run_count: validRuns.length,
    test_count: tests.length,
    tests,
    quarantine,
    summary,
    verdict: quarantine.length > 0 ? "quarantine_recommended" : "clean",
  };
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}
