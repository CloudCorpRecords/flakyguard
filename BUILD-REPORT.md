# flakyguard — Build Report

MCP Rebuild 1000, Batch 13. Original program build from the
packages-100 plan (cluster A #12), built from the spec in
`~/workspace/mcp-rebuild-100/specs-batch13/flakyguard.md`
(read first). There is no external original; the tool
surface is the program's defined spec. Local build only —
nothing pushed or published.

Identity: repo `flakyguard`, npm `@reneturcios/flakyguard`,
MCP name `io.github.CloudCorpRecords/flakyguard`, version
`0.1.0`, bin `flakyguard` → `dist/cli.js`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json`, `server.json` (description "Flaky-test
  evidence tracker: per-test pass/fail history, flakiness
  rates, and a quarantine list.", 96 chars ≤100; npm entry
  carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/flakyguard:0.1.0` carries **no**
  `version` field), `Dockerfile` (node:20-alpine two-stage,
  label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/flakyguard"`),
  `tsconfig.json`, `.gitignore`, `LICENSE` (MIT, Copyright
  (c) 2026 Rene Turcios), `README.md` (fresh text),
  `CHANGELOG.md` (single 0.1.0 entry, 2026-10-27),
  `package-lock.json` (Route 3, see below)
- `src/index.ts`, `src/cli.ts` (`analyze --input <args.json>`
  where the file holds the full arguments object, `mcp`,
  `--version`; exit 2 usage / 1 runtime error, argument
  validation before any file read), `src/mcp.ts`,
  `src/types.ts`, `src/flakyguard.ts` (core,
  `VERSION = "0.1.0"`)
- `test/flakyguard.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (publish-container `IMAGE = ghcr.io/cloudcorprecords/flakyguard`,
  smoke-test server-name assertion `flakyguard`)

## Tools implemented (1)

- `analyze_test_flakiness` — arguments: `runs` (array,
  required, minItems 1) of `{run_id (string, required),
  results (array, required, minItems 1) of {test (string,
  required), status (string, required, one of passed /
  failed / skipped)}}`, plus `min_runs` (integer, optional,
  minimum 1, default 2) and `quarantine_threshold`
  (number, optional, minimum 0, maximum 1, default 0.5).

  Returns `{run_count, test_count, tests, quarantine,
  summary, verdict}`: per distinct test, `appearances`
  (runs containing it), `passes`, `failures`, `skips`,
  and `evidence_runs` (passes + failures; skips are not
  evidence), sorted by test name ascending; classification
  is `insufficient_data` below `min_runs` evidence, then
  `stable_pass` (no failures), `stable_fail` (no passes),
  or `flaky` (both); `flakiness_rate` is
  min(passes, failures) / evidence_runs (0 with no
  evidence), rounded to 4 decimal places. `quarantine`
  holds the flaky tests whose rate meets the threshold,
  as `{test, passes, failures, flakiness_rate}`, sorted
  by rate descending with name-ascending ties; `summary`
  counts tests by classification; `verdict` is
  `quarantine_recommended` when the quarantine list is
  non-empty, otherwise `clean`.

  The fixture literal
  (`harness/fixtures/flakyguard-tools-original.json`) and
  the `src/mcp.ts` literal are identical, with no
  `$schema` and no `additionalProperties`.

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with an
  explicit inputSchema literal exactly matching the
  fixture, per the standing fleet rule (no McpServer/zod
  schema conversion). Every `tools/call` is validated by
  the core itself, so the MCP and CLI paths share one
  validation implementation.
- Validation is path-naming and total: missing/empty
  `runs`, a run missing `run_id`/`results`, an empty
  `results` array, a result missing `test`/`status`, a
  status outside the enum, a duplicate test inside one
  run, a non-integer or sub-1 `min_runs`, or a threshold
  outside [0, 1] throws an Error naming the offending
  path (e.g. `runs[0].results[1].status must be one of
  passed, failed, skipped`) and produces no partial
  result (MCP: `isError`; CLI: exit 1).
- Local choices where the spec is silent (see also
  "Gaps"): the quarantine threshold is compared against
  the rounded `flakiness_rate` that appears in the
  output; the duplicate-test error names the second
  occurrence's path (`runs[i].results[j].test duplicates
  test '<name>' in the same run`); a `NaN` threshold is
  rejected as not a number via a finiteness check.

## Verification (foreground, this session)

- `npx tsc` exit 0 (`dist/cli.js` built)
- `npm test` (`tsx --test test/*.test.ts`): **24 tests,
  24 pass, 0 fail** — per-test aggregation (appearances,
  passes, failures, skips), name-ascending sort,
  appearances for tests present in only some runs, skips
  counted but never as evidence, the same test allowed
  across runs, the flakiness_rate formula with 4-dp
  rounding and the 0.5 split / 0 one-sided cases, all
  four classifications, the default `min_runs` of 2 with
  insufficient passes and failures alike, the
  evidence == min_runs boundary, `min_runs` 1 behaviour,
  quarantine at the default 0.5 threshold (boundary
  included, below excluded), a custom threshold at its
  boundary, thresholds 0 and 1, quarantine sorting
  (rate descending, name-ascending ties) and entry
  shape, non-flaky tests never quarantined, verdict in
  both directions, and the validation/error paths
  (missing/empty runs, missing run_id/results naming
  the path, missing result test/status naming the path,
  a status outside the enum at the spec's exact example
  path, a duplicate test inside one run, non-integer
  and sub-1 min_runs, and out-of-range or wrongly typed
  thresholds)
- `dist/cli.js --version` → `0.1.0`; unknown command
  exits 2 with usage; `analyze` with no `--input` exits
  2; `analyze --input <missing file>` exits 1 naming
  the file; `analyze --input <valid file>` exits 0 and
  prints the analysis JSON (hand-checked: alpha flaky
  at 0.3333 from 2 passes / 1 failure, beta stable_fail
  at 0/3, gamma stable_pass with 2 passes and 1 skip,
  summary 1 stable_pass / 1 stable_fail / 1 flaky / 0
  insufficient_data, quarantine empty, verdict clean);
  `analyze --input <invalid file>` (a status of
  "errored") exits 1 naming
  `runs[0].results[1].status`
- Parity: `harness/parity.py` vs
  `harness/fixtures/flakyguard-tools-original.json` →
  **PASS, parity 100.0, identical_tools 1/1**

## Lockfile status

`package-lock.json` generated clean via Route 3 (temp
copy without `node_modules`/`dist`/`package-lock.json`,
offline `npm install --package-lock-only
--ignore-scripts --offline`), verified: parses, name
`@reneturcios/flakyguard`, **128 package entries**.
Local `node_modules` was installed via `npm install
--ignore-scripts --offline` for build/test; gitignored.

## Gaps / honest notes

- **Quarantine comparison:** the threshold is compared
  against the rounded `flakiness_rate` that appears in
  the output, keeping the quarantine list consistent
  with the reported numbers; the spec does not
  distinguish raw vs rounded here.
- **Rate ceiling:** a flaky test's rate is
  min(passes, failures) / evidence, which cannot exceed
  0.5, so a threshold above 0.5 always yields an empty
  quarantine list and a `clean` verdict. This follows
  directly from the spec's formula and is pinned by a
  test at threshold 1.
- Container build not exercised locally; the
  publish-container workflow smoke-tests the image at
  publish time.
- Nothing pushed or published; this is a local build only.
