/**
 * Prompt QA Tests — Automated verification of Isabel responses.
 *
 * Calls the Snowflake Cortex Agent API directly (no browser, no Next.js server)
 * and verifies that responses meet behavioral and deterministic expectations.
 *
 * Prerequisites:
 *   - SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_RSA_KEY env vars set
 *   - SNOWFLAKE_URL env var set
 *   - Network access to Snowflake
 *
 * Run:
 *   npm run test:prompt-qa
 */

import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseAgentSSEStream, ParsedAgentResponse } from "./parse-sse-stream";
import { PROMPT_QA_CASES, PromptQACase } from "./prompt-cases";
import {
  AgentClientConfig,
  getAgentConfig,
  getTestJWT,
  sendPrompt,
} from "./snowflake-client";

describe("Prompt QA", () => {
  let config: AgentClientConfig;
  let token: string;
  const results: Array<{
    id: string;
    prompt: string;
    response: ParsedAgentResponse;
    passed: boolean;
    duration: number;
  }> = [];

  beforeAll(() => {
    const requiredEnvVars = [
      "SNOWFLAKE_ACCOUNT",
      "SNOWFLAKE_USER",
      "SNOWFLAKE_RSA_KEY",
      "SNOWFLAKE_URL",
    ];

    const missing = requiredEnvVars.filter((v) => !process.env[v]);
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables for prompt QA tests: ${missing.join(", ")}. ` +
          "Ensure .env.local is loaded or variables are exported.",
      );
    }

    config = getAgentConfig();
    token = getTestJWT();
  });

  afterAll(() => {
    // Print summary report
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

    console.log(
      "\n╔══════════════════════════════════════════════════════════╗",
    );
    console.log(
      "║              PROMPT QA RESULTS SUMMARY                    ║",
    );
    console.log("╠══════════════════════════════════════════════════════════╣");
    console.log(
      `║  Total: ${results.length}  |  Passed: ${passed}  |  Failed: ${failed}`,
    );
    console.log(`║  Duration: ${(totalDuration / 1000).toFixed(1)}s`);
    console.log("╠══════════════════════════════════════════════════════════╣");

    for (const r of results) {
      const status = r.passed ? "✓" : "✗";
      const dur = `${(r.duration / 1000).toFixed(1)}s`;
      console.log(`║  ${status} ${r.id.padEnd(30)} ${dur.padStart(6)}`);
    }
    console.log(
      "╚══════════════════════════════════════════════════════════╝\n",
    );

    // Write results to JSON for Copilot evaluator or CI artifacts
    if (process.env.PROMPT_QA_OUTPUT) {
      const outputPath = process.env.PROMPT_QA_OUTPUT;
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
      console.log(`Results written to: ${outputPath}`);
    }
  });

  for (const qaCase of PROMPT_QA_CASES) {
    const testFn = qaCase.skip ? it.skip : it;

    testFn(
      `[${qaCase.id}] ${qaCase.prompt}`,
      async () => {
        const start = Date.now();
        let response: ParsedAgentResponse;

        try {
          const rawResponse = await sendPrompt(qaCase.prompt, config, token);
          response = await parseAgentSSEStream(rawResponse);
        } catch (err) {
          const duration = Date.now() - start;
          results.push({
            id: qaCase.id,
            prompt: qaCase.prompt,
            response: {
              text: "",
              thinking: "",
              toolsUsed: [],
              hasTable: false,
              hasChart: false,
              toolResults: [],
              completed: false,
              error: String(err),
            },
            passed: false,
            duration,
          });
          throw err;
        }

        const duration = Date.now() - start;
        let passed = true;

        try {
          assertExpectations(qaCase, response);
        } catch (err) {
          passed = false;
          results.push({
            id: qaCase.id,
            prompt: qaCase.prompt,
            response,
            passed,
            duration,
          });
          throw err;
        }

        results.push({
          id: qaCase.id,
          prompt: qaCase.prompt,
          response,
          passed,
          duration,
        });
      },
      qaCase.timeout ?? 180_000,
    );
  }
});

/**
 * Assert all expectations for a prompt QA case against the parsed response.
 */
function assertExpectations(
  qaCase: PromptQACase,
  response: ParsedAgentResponse,
): void {
  const { expectations } = qaCase;

  // Stream should complete without error
  expect(
    response.error,
    `Agent returned error: ${response.error}`,
  ).toBeUndefined();
  expect(response.completed, "Stream did not complete").toBe(true);

  // Tool usage
  if (expectations.usesTool) {
    expect(
      response.toolsUsed,
      `Expected tool "${expectations.usesTool}" to be used, got: [${response.toolsUsed.join(", ")}]`,
    ).toContain(expectations.usesTool);
  }

  // Table presence
  if (expectations.hasTable) {
    expect(response.hasTable, "Expected tabular data in response").toBe(true);
  }

  // Deterministic field containment (ALL must match)
  if (expectations.containsAll && expectations.containsAll.length > 0) {
    const lowerText = response.text.toLowerCase();
    for (const kw of expectations.containsAll) {
      expect(
        lowerText.includes(kw.toLowerCase()),
        `Response MUST contain "${kw}" but did not.\nResponse preview: "${response.text.slice(0, 300)}..."`,
      ).toBe(true);
    }
  }

  // Loose keyword containment (any)
  if (expectations.containsAny && expectations.containsAny.length > 0) {
    const lowerText = response.text.toLowerCase();
    const found = expectations.containsAny.some((kw) =>
      lowerText.includes(kw.toLowerCase()),
    );
    expect(
      found,
      `Response should contain one of [${expectations.containsAny.join(", ")}]\nResponse preview: "${response.text.slice(0, 300)}..."`,
    ).toBe(true);
  }

  // Negative assertions (must NOT contain)
  if (expectations.doesNotContain && expectations.doesNotContain.length > 0) {
    const fullText = response.text + response.thinking;
    for (const banned of expectations.doesNotContain) {
      expect(
        fullText.includes(banned),
        `Response must NOT contain "${banned}" but it does`,
      ).toBe(false);
    }
  }

  // Length bounds
  if (expectations.minLength !== undefined) {
    expect(
      response.text.length,
      `Response too short (${response.text.length} < ${expectations.minLength})`,
    ).toBeGreaterThanOrEqual(expectations.minLength);
  }

  if (expectations.maxLength !== undefined) {
    expect(
      response.text.length,
      `Response too long (${response.text.length} > ${expectations.maxLength})`,
    ).toBeLessThanOrEqual(expectations.maxLength);
  }
}
