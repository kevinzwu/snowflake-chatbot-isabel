"use client";

import { parseMarkdownTable } from "@/lib/parse-markdown-table";
import {
  buildMipCustomProperties,
  type MipLabelConfig,
} from "@/lib/sensitivity-label";
import ExcelJS from "exceljs";
import { motion } from "framer-motion";
import JSZip from "jszip";
import { useState } from "react";
import { toast } from "sonner";
import { useAppConfig } from "./app-config-provider";
import { DownloadIcon, LoaderIcon } from "./icons";
import { Markdown } from "./markdown";
import { Button } from "./ui/button";

export interface ChatTableComponentProps {
  tableMarkdown: string;
  toolResult: boolean;
}

/**
 * Inject MIP sensitivity label custom properties into an OOXML (.xlsx) buffer.
 * Writes or appends to docProps/custom.xml and updates [Content_Types].xml.
 */
async function injectMipCustomProperties(
  buffer: ArrayBuffer,
  props: Record<string, string>,
): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer);

  // Build custom.xml with MIP properties
  let pid = 2; // Property IDs start at 2 per OOXML spec
  const propertyElements = Object.entries(props)
    .map(
      ([name, value]) =>
        `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${pid++}" name="${escapeXmlAttribute(name)}">` +
        `<vt:lpwstr>${escapeXml(value)}</vt:lpwstr></property>`,
    )
    .join("\n    ");

  const customXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ` +
    `xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">\n` +
    `    ${propertyElements}\n` +
    `</Properties>`;

  zip.file("docProps/custom.xml", customXml);

  // Ensure [Content_Types].xml includes the custom properties content type
  const contentTypesXml = await zip.file("[Content_Types].xml")?.async("text");
  if (contentTypesXml && !contentTypesXml.includes("custom-properties")) {
    const updatedContentTypes = contentTypesXml.replace(
      "</Types>",
      `<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>\n</Types>`,
    );
    zip.file("[Content_Types].xml", updatedContentTypes);
  }

  // Ensure _rels/.rels includes the relationship to custom.xml
  const relsXml = await zip.file("_rels/.rels")?.async("text");
  if (relsXml && !relsXml.includes("custom-properties")) {
    const updatedRels = relsXml.replace(
      "</Relationships>",
      `<Relationship Id="rIdCustom" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>\n</Relationships>`,
    );
    zip.file("_rels/.rels", updatedRels);
  }

  return zip.generateAsync({ type: "arraybuffer" });
}

/** Escape special characters for XML text content */
function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape special characters for XML attribute values */
function escapeXmlAttribute(str: string): string {
  return escapeXml(str).replace(/"/g, "&quot;");
}

/**
 * Export table data to Excel file
 */
async function exportToExcel(
  headers: string[],
  rows: string[][],
  mipConfig: MipLabelConfig,
  filename: string = "table-data",
) {
  const generatedAt = new Date().toLocaleString();

  const wb = new ExcelJS.Workbook();

  const worksheet = wb.addWorksheet("Data");

  // Build worksheet with confidentiality label, blank row, then headers + data
  worksheet.addRow(["CONFIDENTIAL"]);
  worksheet.addRow([`Generated on: ${generatedAt}`]);
  worksheet.addRow([]); // blank spacer row
  const headerRow = worksheet.addRow(headers);
  headerRow.font = { bold: true };
  for (const row of rows) {
    worksheet.addRow(row);
  }

  // Auto-size columns based on content
  worksheet.columns = headers.map((header, colIndex) => {
    const maxLength = Math.max(
      header.length,
      ...rows.map((row) => (row[colIndex] || "").toString().length),
    );
    return { width: Math.min(maxLength + 2, 50) };
  });

  // Merge the confidentiality label across all header columns
  if (headers.length > 1) {
    worksheet.mergeCells(1, 1, 1, headers.length);
    worksheet.mergeCells(2, 1, 2, headers.length);
  }

  // Set header/footer for print
  worksheet.headerFooter.oddHeader = "CONFIDENTIAL";
  worksheet.headerFooter.oddFooter = "CONFIDENTIAL";

  // Generate timestamp for filename
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, "");

  // Write to buffer and inject MIP labels if configured
  let xlsxBuffer = await wb.xlsx.writeBuffer();

  // Post-process the OOXML package to inject MIP sensitivity label custom properties
  const mipProps = buildMipCustomProperties(mipConfig);
  if (Object.keys(mipProps).length > 0) {
    xlsxBuffer = await injectMipCustomProperties(
      xlsxBuffer as ArrayBuffer,
      mipProps,
    );
  }

  const blob = new Blob([xlsxBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}_${timestamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ChatTableComponent(props: ChatTableComponentProps) {
  const { tableMarkdown, toolResult } = props;
  const { mipLabel } = useAppConfig();
  const [isExporting, setIsExporting] = useState(false);

  const handleExportToExcel = async () => {
    if (isExporting) return;

    setIsExporting(true);
    try {
      const { headers, rows } = parseMarkdownTable(tableMarkdown);

      if (headers.length === 0 || rows.length === 0) {
        toast.error("Unable to export table", {
          description: "Could not parse table data from the response.",
        });
        return;
      }

      await exportToExcel(headers, rows, mipLabel, "query-results");
      toast.success("Table exported successfully!", {
        description: "Your Excel file has been downloaded.",
      });
    } catch (error) {
      console.error("Failed to export table:", error);
      toast.error("Failed to export table", {
        description:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const ExportButton = () => (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleExportToExcel}
      disabled={isExporting}
      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
      title="Export to Excel"
      {...(isExporting ? { "aria-label": "Exporting table..." } : {})}
    >
      {isExporting ? (
        <LoaderIcon size={14} />
      ) : (
        <>
          <DownloadIcon size={14} />
          <span className="ml-1">Export</span>
        </>
      )}
    </Button>
  );

  return (
    <motion.div
      className="w-full mx-auto max-w-3xl pr-4 pl-0 group/message"
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1, transition: { delay: 0 } }}
      data-table-content="true"
    >
      {toolResult ? (
        <details open={false}>
          <summary className="cursor-pointer select-none">
            <span>View result table</span>
          </summary>
          <div className="mt-2">
            <div className="flex justify-end mb-1">
              <ExportButton />
            </div>
            <Markdown>{tableMarkdown}</Markdown>
          </div>
        </details>
      ) : (
        <div>
          <div className="flex justify-end mb-1">
            <ExportButton />
          </div>
          <Markdown>{tableMarkdown}</Markdown>
        </div>
      )}
    </motion.div>
  );
}
