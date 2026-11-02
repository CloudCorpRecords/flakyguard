/**
 * flakyguard types.
 *
 * flakyguard tracks flaky-test evidence across a set of CI
 * runs. The caller supplies each run's per-test outcomes, and
 * flakyguard reports, as pure local computation:
 *
 *   - per-test appearances, passes, failures, and skips
 *     aggregated across every run that mentions the test
 *   - an evidence count (passes + failures; skips do not
 *     count as evidence) and a classification for each test
 *   - a flakiness rate derived from the minority outcome
 *   - a quarantine list of flaky tests at or above a
 *     caller-supplied rate threshold
 *   - summary counts by classification and an overall
 *     verdict
 *
 * Nothing is fetched or guessed: every number comes only
 * from the runs supplied.
 */

/** Outcome of one test inside one run. */
export type TestStatus = "passed" | "failed" | "skipped";

/** One test result inside one run, as supplied by the caller. */
export interface TestResult {
  /** Test name; must not repeat inside a single run. */
  test: string;
  /** Outcome of the test in this run. */
  status: TestStatus;
}

/** One CI run, as supplied by the caller. */
export interface FlakyRun {
  /** Identifier for the run. */
  run_id: string;
  /** Results in the run; at least one. */
  results: TestResult[];
}

/** Classification assigned to a test from its evidence. */
export type Classification =
  | "stable_pass"
  | "stable_fail"
  | "flaky"
  | "insufficient_data";

/** Aggregated evidence for one distinct test name. */
export interface TestStats {
  test: string;
  /** Runs whose results contain this test. */
  appearances: number;
  passes: number;
  failures: number;
  skips: number;
  /** passes + failures; skips are not evidence. */
  evidence_runs: number;
  classification: Classification;
  /** min(passes, failures) / evidence_runs (0 when evidence is 0), rounded to 4 dp. */
  flakiness_rate: number;
}

/** One entry on the quarantine list. */
export interface QuarantineEntry {
  test: string;
  passes: number;
  failures: number;
  flakiness_rate: number;
}

/** Counts of distinct tests by classification. */
export interface FlakinessSummary {
  stable_pass: number;
  stable_fail: number;
  flaky: number;
  insufficient_data: number;
}

/** The flakiness analysis. */
export interface FlakinessResult {
  run_count: number;
  /** Number of distinct test names across all runs. */
  test_count: number;
  tests: TestStats[];
  quarantine: QuarantineEntry[];
  summary: FlakinessSummary;
  /** "quarantine_recommended" when the quarantine list is non-empty, otherwise "clean". */
  verdict: "quarantine_recommended" | "clean";
}
