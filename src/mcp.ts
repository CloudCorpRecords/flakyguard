/**
 * flakyguard MCP server. Tools: analyze_test_flakiness.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys
 * not in this tool's defined spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schema as an explicit literal, and every
 * tools/call is validated by the core, which names the
 * offending path on invalid input.
 *
 * The analysis is pure local computation: no upstream API,
 * no authentication, no configuration.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { analyzeTestFlakiness, formatPayload, VERSION } from "./flakyguard.js";

const TOOLS = [
  {
    name: "analyze_test_flakiness",
    description:
      "Analyze test flakiness across CI runs: per-test pass/fail/skip history, evidence runs, flakiness rates and classifications, a quarantine list at a configurable threshold, summary counts, and a verdict.",
    inputSchema: {
      type: "object" as const,
      properties: {
        runs: {
          type: "array",
          description: "CI runs to analyze (at least one)",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              run_id: { type: "string", description: "Identifier for the run" },
              results: {
                type: "array",
                description: "Test results in the run (at least one)",
                minItems: 1,
                items: {
                  type: "object",
                  properties: {
                    test: { type: "string", description: "Test name" },
                    status: {
                      type: "string",
                      description: "Test outcome: passed, failed, or skipped",
                      enum: ["passed", "failed", "skipped"],
                    },
                  },
                  required: ["test", "status"],
                },
              },
            },
            required: ["run_id", "results"],
          },
        },
        min_runs: {
          type: "integer",
          description:
            "Minimum evidence runs (passes + failures) before a test is classified as stable or flaky (optional, default 2)",
          minimum: 1,
        },
        quarantine_threshold: {
          type: "number",
          description:
            "Flakiness-rate threshold for the quarantine list (optional, default 0.5)",
          minimum: 0,
          maximum: 1,
        },
      },
      required: ["runs"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "flakyguard", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let out: unknown;
    if (name === "analyze_test_flakiness") {
      const raw = (args ?? {}) as Record<string, unknown>;
      out = analyzeTestFlakiness(raw.runs, raw.min_runs, raw.quarantine_threshold);
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
