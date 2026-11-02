# flakyguard

"That test is flaky" is usually a feeling. flakyguard turns
it into evidence. Feed it the per-test outcomes from a set
of CI runs and it builds the record for every test:

- **Per-test history** — how many runs contained the test,
  and how many times it passed, failed, or was skipped
- **Evidence runs** — passes plus failures; a skip is
  recorded but never counts as evidence, because a test
  that did not run proves nothing either way
- **Classification** — a test needs a minimum amount of
  evidence (two evidence runs by default) before it earns
  a verdict: `stable_pass` if it never failed,
  `stable_fail` if it never passed, `flaky` if it did
  both, and `insufficient_data` until then
- **Flakiness rate** — the minority outcome's share of the
  evidence runs, so a test that splits its results evenly
  rates 0.5 and a mostly reliable one rates close to 0
- **Quarantine list** — the flaky tests whose rate meets
  the quarantine threshold (0.5 by default), worst first,
  each entry carrying the pass/fail counts behind its rate
- **Verdict** — `quarantine_recommended` when the list is
  non-empty, otherwise `clean`

Rates are rounded to four decimal places. Everything is
computed locally from the runs you supply: no network, no
configuration, no history kept between calls. Bad input —
a run with no results, a status outside
`passed` / `failed` / `skipped`, the same test twice in
one run — is rejected with an error naming the offending
path, and no partial analysis is produced.

## CLI

```bash
npx @reneturcios/flakyguard analyze --input args.json
npx @reneturcios/flakyguard --version
```

`args.json` contains the full arguments object:

```json
{
  "runs": [
    {
      "run_id": "run-101",
      "results": [
        { "test": "checkout totals", "status": "passed" },
        { "test": "search ranking", "status": "failed" }
      ]
    },
    {
      "run_id": "run-102",
      "results": [
        { "test": "checkout totals", "status": "failed" },
        { "test": "search ranking", "status": "failed" }
      ]
    }
  ],
  "min_runs": 2,
  "quarantine_threshold": 0.5
}
```

`min_runs` and `quarantine_threshold` are optional. The
analysis is printed as JSON.

Exit codes: `0` on success, `1` on a runtime error
(including an unreadable or invalid input file, or
invalid input), `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/flakyguard mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "flakyguard": {
      "command": "npx",
      "args": ["-y", "@reneturcios/flakyguard", "mcp"]
    }
  }
}
```

### Tools

- `analyze_test_flakiness` — Analyze test flakiness
  across CI runs.
  - `runs` (array, required, at least one) — runs as
    `{run_id, results}` objects, where each result is
    `{test, status}` and `status` is one of `passed`,
    `failed`, `skipped`; a test may not appear twice in
    one run
  - `min_runs` (integer, optional, >= 1, default 2) —
    minimum evidence runs before a test is classified
    as stable or flaky
  - `quarantine_threshold` (number, optional, 0 to 1,
    default 0.5) — flakiness-rate threshold for the
    quarantine list

  Returns `{run_count, test_count, tests, quarantine,
  summary, verdict}`.

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/flakyguard
docker run --rm -v "$PWD:/w" ghcr.io/cloudcorprecords/flakyguard analyze --input /w/args.json
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (pure local, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
