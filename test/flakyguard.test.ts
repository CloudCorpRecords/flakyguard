import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeTestFlakiness } from "../src/flakyguard.js";

/**
 * All tests are pure local computation over inline run
 * histories: no filesystem, no network. Each behaviour in
 * the spec is pinned by its own case, including the
 * classification boundaries and every validation path.
 */

type Status = "passed" | "failed" | "skipped";

const run = (id: string, results: Array<[string, Status]>) => ({
  run_id: id,
  results: results.map(([test, status]) => ({ test, status })),
});

describe("analyzeTestFlakiness — aggregation", () => {
  it("aggregates appearances, passes, failures, and skips per test", () => {
    const out = analyzeTestFlakiness([
      run("r1", [["alpha", "passed"], ["beta", "failed"], ["gamma", "passed"]]),
      run("r2", [["alpha", "failed"], ["beta", "failed"], ["gamma", "passed"]]),
      run("r3", [["alpha", "passed"], ["beta", "failed"], ["gamma", "skipped"]]),
    ]);
    assert.equal(out.run_count, 3);
    assert.equal(out.test_count, 3);
    assert.deepEqual(out.tests, [
      { test: "alpha", appearances: 3, passes: 2, failures: 1, skips: 0, evidence_runs: 3, classification: "flaky", flakiness_rate: 0.3333 },
      { test: "beta", appearances: 3, passes: 0, failures: 3, skips: 0, evidence_runs: 3, classification: "stable_fail", flakiness_rate: 0 },
      { test: "gamma", appearances: 3, passes: 2, failures: 0, skips: 1, evidence_runs: 2, classification: "stable_pass", flakiness_rate: 0 },
    ]);
    assert.deepEqual(out.summary, { stable_pass: 1, stable_fail: 1, flaky: 1, insufficient_data: 0 });
    assert.deepEqual(out.quarantine, []);
    assert.equal(out.verdict, "clean");
  });

  it("sorts tests by name ascending regardless of input order", () => {
    const out = analyzeTestFlakiness([
      run("r1", [["zebra", "passed"], ["alpha", "passed"], ["mid", "passed"]]),
      run("r2", [["zebra", "passed"], ["alpha", "passed"], ["mid", "passed"]]),
    ]);
    assert.deepEqual(
      out.tests.map((t) => t.test),
      ["alpha", "mid", "zebra"],
    );
  });

  it("counts appearances only for runs that contain the test", () => {
    const out = analyzeTestFlakiness([
      run("r1", [["sometimes", "passed"], ["always", "passed"]]),
      run("r2", [["always", "passed"]]),
      run("r3", [["always", "failed"]]),
    ]);
    const sometimes = out.tests.find((t) => t.test === "sometimes");
    assert.equal(sometimes?.appearances, 1);
    assert.equal(sometimes?.evidence_runs, 1);
    const always = out.tests.find((t) => t.test === "always");
    assert.equal(always?.appearances, 3);
  });

  it("counts skips but never treats them as evidence", () => {
    const out = analyzeTestFlakiness([
      run("r1", [["skippy", "skipped"]]),
      run("r2", [["skippy", "skipped"]]),
      run("r3", [["skippy", "skipped"]]),
    ]);
    assert.deepEqual(out.tests[0], {
      test: "skippy",
      appearances: 3,
      passes: 0,
      failures: 0,
      skips: 3,
      evidence_runs: 0,
      classification: "insufficient_data",
      flakiness_rate: 0,
    });
  });

  it("allows the same test in different runs (only a duplicate inside one run is an error)", () => {
    const out = analyzeTestFlakiness([
      run("r1", [["a", "passed"]]),
      run("r2", [["a", "passed"]]),
    ]);
    assert.equal(out.tests[0].appearances, 2);
    assert.equal(out.tests[0].classification, "stable_pass");
  });
});

describe("analyzeTestFlakiness — flakiness_rate", () => {
  it("is min(passes, failures) / evidence_runs", () => {
    const out = analyzeTestFlakiness([
      run("r1", [["t", "passed"]]),
      run("r2", [["t", "passed"]]),
      run("r3", [["t", "passed"]]),
      run("r4", [["t", "failed"]]),
    ]);
    assert.equal(out.tests[0].flakiness_rate, 0.25);
  });

  it("rounds to 4 decimal places", () => {
    const out = analyzeTestFlakiness([
      run("r1", [["t", "passed"]]),
      run("r2", [["t", "failed"]]),
      run("r3", [["t", "failed"]]),
    ]);
    assert.equal(out.tests[0].flakiness_rate, 0.3333);
  });

  it("is 0.5 for a perfectly split history and 0 for one-sided history", () => {
    const split = analyzeTestFlakiness([
      run("r1", [["t", "passed"]]),
      run("r2", [["t", "failed"]]),
    ]);
    assert.equal(split.tests[0].flakiness_rate, 0.5);
    const oneSided = analyzeTestFlakiness([
      run("r1", [["t", "failed"]]),
      run("r2", [["t", "failed"]]),
    ]);
    assert.equal(oneSided.tests[0].flakiness_rate, 0);
  });
});

describe("analyzeTestFlakiness — classification", () => {
  it("classifies stable_pass, stable_fail, and flaky with enough evidence", () => {
    const out = analyzeTestFlakiness([
      run("r1", [["p", "passed"], ["f", "failed"], ["x", "passed"]]),
      run("r2", [["p", "passed"], ["f", "failed"], ["x", "failed"]]),
    ]);
    assert.equal(out.tests.find((t) => t.test === "p")?.classification, "stable_pass");
    assert.equal(out.tests.find((t) => t.test === "f")?.classification, "stable_fail");
    assert.equal(out.tests.find((t) => t.test === "x")?.classification, "flaky");
    assert.deepEqual(out.summary, { stable_pass: 1, stable_fail: 1, flaky: 1, insufficient_data: 0 });
  });

  it("uses insufficient_data below the default min_runs of 2, for passes and failures alike", () => {
    const out = analyzeTestFlakiness([
      run("r1", [["one-pass", "passed"], ["one-fail", "failed"]]),
    ]);
    assert.equal(out.tests.find((t) => t.test === "one-pass")?.classification, "insufficient_data");
    assert.equal(out.tests.find((t) => t.test === "one-fail")?.classification, "insufficient_data");
    assert.deepEqual(out.summary, { stable_pass: 0, stable_fail: 0, flaky: 0, insufficient_data: 2 });
  });

  it("classifies at the boundary evidence_runs == min_runs", () => {
    const out = analyzeTestFlakiness(
      [
        run("r1", [["t", "passed"]]),
        run("r2", [["t", "passed"]]),
        run("r3", [["t", "passed"]]),
      ],
      3,
    );
    assert.equal(out.tests[0].classification, "stable_pass");
    const below = analyzeTestFlakiness(
      [run("r1", [["t", "passed"]]), run("r2", [["t", "passed"]])],
      3,
    );
    assert.equal(below.tests[0].classification, "insufficient_data");
  });

  it("honours min_runs of 1: a single outcome is enough to classify", () => {
    const passed = analyzeTestFlakiness([run("r1", [["t", "passed"]])], 1);
    assert.equal(passed.tests[0].classification, "stable_pass");
    const failed = analyzeTestFlakiness([run("r1", [["t", "failed"]])], 1);
    assert.equal(failed.tests[0].classification, "stable_fail");
    const split = analyzeTestFlakiness(
      [run("r1", [["t", "passed"]]), run("r2", [["t", "failed"]])],
      1,
    );
    assert.equal(split.tests[0].classification, "flaky");
  });
});

describe("analyzeTestFlakiness — quarantine and verdict", () => {
  const splitRuns = () => [
    run("r1", [["even", "passed"], ["lean", "passed"]]),
    run("r2", [["even", "failed"], ["lean", "passed"]]),
    run("r3", [["lean", "passed"]]),
    run("r4", [["lean", "failed"]]),
  ];
  // even: 1 pass / 1 fail -> rate 0.5; lean: 3 passes / 1 fail -> rate 0.25.

  it("includes a flaky test at exactly the default threshold of 0.5 and excludes one below it", () => {
    const out = analyzeTestFlakiness(splitRuns());
    assert.deepEqual(out.quarantine, [
      { test: "even", passes: 1, failures: 1, flakiness_rate: 0.5 },
    ]);
    assert.equal(out.verdict, "quarantine_recommended");
  });

  it("honours a custom threshold, including the boundary rate", () => {
    const out = analyzeTestFlakiness(splitRuns(), 2, 0.25);
    assert.deepEqual(
      out.quarantine.map((q) => q.test),
      ["even", "lean"],
    );
  });

  it("accepts thresholds 0 and 1; at 1 nothing qualifies because a flaky rate cannot exceed 0.5", () => {
    const atZero = analyzeTestFlakiness(splitRuns(), 2, 0);
    assert.equal(atZero.quarantine.length, 2);
    const atOne = analyzeTestFlakiness(splitRuns(), 2, 1);
    assert.deepEqual(atOne.quarantine, []);
    assert.equal(atOne.verdict, "clean");
  });

  it("sorts quarantine by rate descending, ties by test name ascending", () => {
    const out = analyzeTestFlakiness(
      [
        run("r1", [["b-tie", "passed"], ["a-tie", "passed"], ["c-low", "passed"]]),
        run("r2", [["b-tie", "failed"], ["a-tie", "failed"], ["c-low", "passed"]]),
        run("r3", [["c-low", "passed"]]),
        run("r4", [["c-low", "failed"]]),
      ],
      2,
      0.2,
    );
    // a-tie and b-tie rate 0.5; c-low rates 0.25 (3 passes, 1 failure).
    assert.deepEqual(
      out.quarantine.map((q) => q.test),
      ["a-tie", "b-tie", "c-low"],
    );
    assert.deepEqual(out.quarantine[2], { test: "c-low", passes: 3, failures: 1, flakiness_rate: 0.25 });
  });

  it("never quarantines a non-flaky test, and verdict is clean when quarantine is empty", () => {
    const out = analyzeTestFlakiness(
      [
        run("r1", [["steady", "passed"], ["broken", "failed"]]),
        run("r2", [["steady", "passed"], ["broken", "failed"]]),
      ],
      2,
      0,
    );
    assert.deepEqual(out.quarantine, []);
    assert.equal(out.verdict, "clean");
  });
});

describe("analyzeTestFlakiness — validation", () => {
  it("rejects missing or empty runs", () => {
    assert.throws(() => analyzeTestFlakiness(undefined), /runs is required/);
    assert.throws(() => analyzeTestFlakiness([]), /runs must be a non-empty array/);
    assert.throws(() => analyzeTestFlakiness("nope"), /runs must be a non-empty array/);
  });

  it("rejects a run missing run_id or results, naming the path", () => {
    assert.throws(
      () => analyzeTestFlakiness([{ results: [{ test: "a", status: "passed" }] }]),
      /runs\[0\]\.run_id is required/,
    );
    assert.throws(
      () => analyzeTestFlakiness([run("r1", [["a", "passed"]]), { run_id: "r2" }]),
      /runs\[1\]\.results is required/,
    );
    assert.throws(
      () => analyzeTestFlakiness([{ run_id: "r1", results: [] }]),
      /runs\[0\]\.results must be a non-empty array/,
    );
    assert.throws(
      () => analyzeTestFlakiness([{ run_id: "", results: [{ test: "a", status: "passed" }] }]),
      /runs\[0\]\.run_id must be a non-empty string/,
    );
  });

  it("rejects a result missing test or status, naming the path", () => {
    assert.throws(
      () => analyzeTestFlakiness([{ run_id: "r1", results: [{ status: "passed" }] }]),
      /runs\[0\]\.results\[0\]\.test is required/,
    );
    assert.throws(
      () =>
        analyzeTestFlakiness([
          run("r1", [["a", "passed"]]),
          { run_id: "r2", results: [{ test: "b" }] },
        ]),
      /runs\[1\]\.results\[0\]\.status is required/,
    );
    assert.throws(
      () => analyzeTestFlakiness([{ run_id: "r1", results: [{ test: "", status: "passed" }] }]),
      /runs\[0\]\.results\[0\]\.test must be a non-empty string/,
    );
  });

  it("rejects a status outside the enum, naming the exact path from the spec", () => {
    assert.throws(
      () =>
        analyzeTestFlakiness([
          {
            run_id: "r1",
            results: [
              { test: "a", status: "passed" },
              { test: "b", status: "errored" },
            ],
          },
        ]),
      /runs\[0\]\.results\[1\]\.status must be one of passed, failed, skipped/,
    );
  });

  it("rejects a duplicate test inside one run, naming the path", () => {
    assert.throws(
      () =>
        analyzeTestFlakiness([
          {
            run_id: "r1",
            results: [
              { test: "a", status: "passed" },
              { test: "a", status: "failed" },
            ],
          },
        ]),
      /runs\[0\]\.results\[1\]\.test duplicates test 'a' in the same run/,
    );
  });

  it("rejects a non-integer or sub-1 min_runs", () => {
    const runs = [run("r1", [["a", "passed"]])];
    assert.throws(() => analyzeTestFlakiness(runs, 1.5), /min_runs must be an integer/);
    assert.throws(() => analyzeTestFlakiness(runs, "2"), /min_runs must be an integer/);
    assert.throws(() => analyzeTestFlakiness(runs, 0), /min_runs must be >= 1/);
    assert.throws(() => analyzeTestFlakiness(runs, -3), /min_runs must be >= 1/);
  });

  it("rejects a threshold outside [0, 1] or of the wrong type", () => {
    const runs = [run("r1", [["a", "passed"]])];
    assert.throws(() => analyzeTestFlakiness(runs, 2, -0.1), /quarantine_threshold must be between 0 and 1/);
    assert.throws(() => analyzeTestFlakiness(runs, 2, 1.1), /quarantine_threshold must be between 0 and 1/);
    assert.throws(() => analyzeTestFlakiness(runs, 2, "0.5"), /quarantine_threshold must be a number/);
    assert.throws(() => analyzeTestFlakiness(runs, 2, Number.NaN), /quarantine_threshold must be a number/);
  });
});
