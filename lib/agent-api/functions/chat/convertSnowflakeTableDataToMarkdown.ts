/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Converts Snowflake JSON results into a Markdown table.
 * Escapes pipe characters (|) and other markdown special characters to prevent format disruption.
 * @param {object} responseJson - The Snowflake SQL ExecutionResponse.
 * @returns {string} A Markdown string representing the data.
 */
export function convertSnowflakeTableDataToMarkdown(tableData: any): string {
  // Handle both old and new API response structures
  const metaData =
    tableData.resultSetMetaData || tableData.result_set_meta_data;
  const rowTypeData = metaData?.rowType || metaData?.row_type;

  if (!rowTypeData) {
    console.error("Unable to find row type metadata in table data:", tableData);
    return "Error: Invalid table data structure";
  }

  // Extract column names and escape pipe characters
  const columns: string[] = rowTypeData.map((colDef: any) =>
    String(colDef.name).replace(/\|/g, "\|"),
  );

  // Prepare table header in Markdown
  // e.g. | COL1 | COL2 | ... |
  let markdown = `| ${columns.join(" | ")} |\n`;

  // Prepare the header separator row in Markdown
  // e.g. | --- | --- | ... |
  markdown += `| ${columns.map(() => "---").join(" | ")} |\n`;

  // Handle empty result sets (no data property or empty array)
  if (
    !tableData.data ||
    !Array.isArray(tableData.data) ||
    tableData.data.length === 0
  ) {
    markdown += `| ${columns.map(() => "_No data_").join(" | ")} |\n`;
    return markdown;
  }

  // Build table rows
  // tableData.data is an array of arrays, e.g. [ [val1, val2], [val3, val4], ... ]
  tableData.data.forEach((row: any) => {
    const rowValues = row.map((val: any) => {
      if (val == null) return "";

      return String(val)
        .replace(/\|/g, "\|") // Escape pipe characters
        .replace(/\n/g, "<br>") // Convert newlines to HTML breaks
        .replace(/\r/g, ""); // Remove carriage returns
    });

    markdown += `| ${rowValues.join(" | ")} |\n`;
  });

  return markdown;
}
