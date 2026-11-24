/**
 * Canned Cortex Agent response used by demo mode (MOCK_SNOWFLAKE=true).
 *
 * The events follow the order and shapes that lib/agent-api/useAgentAPIQuery.ts
 * parses: thinking, text, a table, a chart, suggested follow-ups, then done.
 * The rows use the HOST_VULNERABILITIES shape from examples/sql and are
 * invented: documentation IP ranges and example.com hosts only.
 */

export interface MockSseEvent {
  event: string;
  data: Record<string, unknown>;
}

const COLUMNS = [
  { name: "FINDING_ID", type: "text" },
  { name: "HOSTNAME", type: "text" },
  { name: "IP_ADDRESS", type: "text" },
  { name: "SEVERITY", type: "text" },
  { name: "STATUS", type: "text" },
  { name: "DUE_DATE", type: "text" },
];

const ROWS: string[][] = [
  [
    "HV-000101",
    "atlas-web-03.example.com",
    "192.0.2.14",
    "Critical",
    "Active",
    "2025-03-04",
  ],
  [
    "HV-000102",
    "atlas-db-07.example.com",
    "192.0.2.31",
    "Critical",
    "Active",
    "2025-03-06",
  ],
  [
    "HV-000103",
    "beacon-app-12.example.com",
    "198.51.100.22",
    "Critical",
    "Reopened",
    "2025-03-09",
  ],
  [
    "HV-000104",
    "cobalt-cache-01.example.com",
    "198.51.100.57",
    "High",
    "Active",
    "2025-03-18",
  ],
  [
    "HV-000105",
    "delta-batch-05.example.com",
    "203.0.113.9",
    "High",
    "Active",
    "2025-03-21",
  ],
  [
    "HV-000106",
    "ember-web-11.example.com",
    "203.0.113.76",
    "High",
    "Active",
    "2025-03-25",
  ],
  [
    "HV-000107",
    "falcon-app-02.example.com",
    "192.0.2.88",
    "High",
    "Reopened",
    "2025-03-28",
  ],
  [
    "HV-000108",
    "granite-db-04.example.com",
    "198.51.100.140",
    "Medium",
    "Active",
    "2025-05-02",
  ],
  [
    "HV-000109",
    "harbor-web-08.example.com",
    "203.0.113.201",
    "Medium",
    "Active",
    "2025-05-11",
  ],
  [
    "HV-000110",
    "harbor-cache-02.example.com",
    "192.0.2.170",
    "Low",
    "Active",
    "2025-08-19",
  ],
];

const ANSWER =
  "Here are the open host vulnerabilities with the earliest remediation deadlines. " +
  "Three are critical, and one of those was reopened after a failed fix. " +
  "This is demo data: no Snowflake account is connected.";

const THINKING = [
  "The question is about open host vulnerabilities. ",
  "I will read HOST_VULNERABILITIES and keep only Active and Reopened rows, ",
  "then order them by due date.",
];

const CHART_SPEC = {
  $schema: "https://vega.github.io/schema/vega-lite/v5.json",
  title: "Open host vulnerabilities by severity",
  data: {
    values: [
      { SEVERITY: "Critical", OPEN_VULNERABILITIES: 3 },
      { SEVERITY: "High", OPEN_VULNERABILITIES: 4 },
      { SEVERITY: "Medium", OPEN_VULNERABILITIES: 2 },
      { SEVERITY: "Low", OPEN_VULNERABILITIES: 1 },
    ],
  },
  mark: "bar",
  encoding: {
    x: {
      field: "SEVERITY",
      type: "ordinal",
      sort: ["Critical", "High", "Medium", "Low"],
      title: "Severity",
    },
    y: {
      field: "OPEN_VULNERABILITIES",
      type: "quantitative",
      title: "Open vulnerabilities",
    },
  },
};

const SUGGESTED_QUERIES = [
  "Which teams have the most overdue critical host vulnerabilities?",
  "Which open vulnerabilities have the highest exploit probability?",
  "What is the average time to remediate by severity?",
];

function splitWords(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

/** The ordered events of one mock agent response (without the final "done"). */
export function buildMockAgentEvents(): MockSseEvent[] {
  const events: MockSseEvent[] = [];
  let seq = 0;
  const push = (event: string, data: Record<string, unknown>): void => {
    events.push({ event, data: { ...data, sequence_number: seq++ } });
  };

  push("response.status", { status: "planning", message: "Planning the work" });
  THINKING.forEach((text) =>
    push("response.thinking.delta", { content_index: 0, text }),
  );
  push("response.thinking", { content_index: 0, text: THINKING.join("") });
  push("response.status", {
    status: "executing_tool",
    message: "Running analyst1",
  });
  splitWords(ANSWER).forEach((text) =>
    push("response.text.delta", { content_index: 1, text }),
  );
  push("response.table", {
    content_index: 2,
    title: "Open host vulnerabilities by due date",
    result_set: {
      data: ROWS,
      resultSetMetaData: {
        format: "jsonv2",
        numRows: ROWS.length,
        partition: 0,
        rowType: COLUMNS.map((c) => ({
          ...c,
          length: 200,
          nullable: true,
          precision: 0,
          scale: 0,
        })),
      },
    },
  });
  push("response.chart", {
    content_index: 3,
    chart_spec: JSON.stringify(CHART_SPEC),
  });
  push("response.suggested_queries", {
    content_index: 4,
    suggested_queries: SUGGESTED_QUERIES.map((query) => ({ query })),
  });
  push("response", { status: "completed" });
  return events;
}

export function toSseChunk(event: MockSseEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/** Stream the mock response with a short pause between events, then "done". */
export function mockAgentStream(delayMs = 25): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const events = [
    ...buildMockAgentEvents(),
    { event: "done", data: {} } as MockSseEvent,
  ];
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= events.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(toSseChunk(events[i++])));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    },
  });
}
