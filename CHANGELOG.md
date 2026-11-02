# Changelog

## 0.1.0 (2026-10-27)

- Initial release: `analyze_test_flakiness` MCP tool and
  `analyze` CLI command tracking flaky-test evidence
  across CI runs.
- Per-test appearances, passes, failures, and skips;
  evidence-based classification with a configurable
  `min_runs`; flakiness rates rounded to 4 decimal
  places; a threshold-based quarantine list and verdict,
  with path-naming validation errors.
