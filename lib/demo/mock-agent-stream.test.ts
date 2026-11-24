import { describe, expect, it } from "vitest";
import { buildMockAgentEvents, mockAgentStream } from "./mock-agent-stream";

describe("buildMockAgentEvents", () => {
  const names = buildMockAgentEvents().map((e) => e.event);
  const firstIndex = (name: string) => names.indexOf(name);

  it("should emit thinking, then text, then the table, then the chart, then suggestions", () => {
    expect(firstIndex("response.thinking.delta")).toBeGreaterThanOrEqual(0);
    expect(firstIndex("response.thinking")).toBeGreaterThan(
      firstIndex("response.thinking.delta"),
    );
    expect(firstIndex("response.text.delta")).toBeGreaterThan(
      firstIndex("response.thinking"),
    );
    expect(firstIndex("response.table")).toBeGreaterThan(
      names.lastIndexOf("response.text.delta"),
    );
    expect(firstIndex("response.chart")).toBeGreaterThan(
      firstIndex("response.table"),
    );
    expect(firstIndex("response.suggested_queries")).toBeGreaterThan(
      firstIndex("response.chart"),
    );
  });

  it("should give the table rows that match its columns", () => {
    const table = buildMockAgentEvents().find(
      (e) => e.event === "response.table",
    )!;
    const resultSet = table.data.result_set as {
      data: string[][];
      resultSetMetaData: { rowType: { name: string }[] };
    };

    expect(resultSet.data.length).toBeGreaterThan(0);
    for (const row of resultSet.data) {
      expect(row).toHaveLength(resultSet.resultSetMetaData.rowType.length);
    }
  });

  it("should give the chart a stringified Vega-Lite spec", () => {
    const chart = buildMockAgentEvents().find(
      (e) => e.event === "response.chart",
    )!;

    const spec = JSON.parse(chart.data.chart_spec as string);
    expect(spec.mark).toBe("bar");
  });

  it("should use only documentation IP ranges and example.com hosts", () => {
    const json = JSON.stringify(buildMockAgentEvents());
    const ips = json.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) ?? [];

    expect(ips.length).toBeGreaterThan(0);
    for (const ip of ips) {
      expect(ip).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\./);
    }
    for (const host of json.match(/[a-z0-9-]+\.example\.com/g) ?? []) {
      expect(host.endsWith(".example.com")).toBe(true);
    }
    expect(json).not.toMatch(/\.(com|net|org)\b(?<!example\.com)/);
  });
});

describe("mockAgentStream", () => {
  it("should stream server-sent events that end with done", async () => {
    const text = await new Response(mockAgentStream(0)).text();

    expect(text.startsWith("event: response.status\n")).toBe(true);
    expect(text.trimEnd().endsWith("event: done\ndata: {}")).toBe(true);
  });
});
