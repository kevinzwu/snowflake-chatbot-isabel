export const CORTEX_ANALYST_TOOL = {
  tool_spec: {
    type: "cortex_analyst_text_to_sql",
    name: "analyst1",
    description:
      "This tool is called analyst1. Primary tool for analyzing vulnerability data and security metrics from structured data. Use this for any question requiring data analysis, trends, comparisons, rankings or statistical information.",
  },
} as const;

export const CORTEX_SEARCH_TOOL = {
  tool_spec: {
    type: "cortex_search",
    name: "search1",
    description:
      "This tool is called search1. Use this tool for searching vulnerability descriptions, remediation steps, and related documentation.",
  },
} as const;

export const RELATED_QUERIES_REGEX =
  /Related query:\s*(.*?)\s*Answer:\s*(.*?)(?=\nRelated query:|\n*$)/gs;
