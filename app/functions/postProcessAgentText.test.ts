/**
 * Tests for postProcessAgentText
 *
 * Tests cover:
 * - Citation marker conversion to HTML spans
 * - Related queries extraction
 * - Combined processing
 * - Edge cases
 */

import { describe, expect, it, vi } from "vitest";

import {
  convertCitationsSpecialCharactersToSpan,
  postProcessAgentText,
} from "@/app/functions/postProcessAgentText";

describe("convertCitationsSpecialCharactersToSpan()", () => {
  it("should convert citation markers to HTML spans", () => {
    const text = "Some text【†1†】and more【†2†】";
    const result = convertCitationsSpecialCharactersToSpan(text);

    expect(result).toContain("1</span>");
    expect(result).toContain("2</span>");
    expect(result).toContain("cursor-default");
    expect(result).not.toContain("【†1†】");
  });

  it("should handle text without citations", () => {
    const text = "No citations here";
    const result = convertCitationsSpecialCharactersToSpan(text);
    expect(result).toBe("No citations here");
  });

  it("should apply correct color classes based on citation number", () => {
    const result = convertCitationsSpecialCharactersToSpan("【†1†】");
    expect(result).toContain("bg-[#F0F2FF]");
    expect(result).toContain("text-[#2446E0]");
  });

  it("should handle citation numbers up to 14", () => {
    const text = "【†14†】";
    const result = convertCitationsSpecialCharactersToSpan(text);
    expect(result).toContain("14</span>");
  });
});

describe("postProcessAgentText()", () => {
  it("should return text as-is when no citations or related queries", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = postProcessAgentText("Simple text", [], []);
    expect(result).toBe("Simple text");
    consoleSpy.mockRestore();
  });

  it("should preserve citation markers for rehypeCitations plugin", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const citations = [
      { source_id: "doc1", source_name: "Document", content: "..." },
    ];
    const text = "See this【†1†】";
    const result = postProcessAgentText(text, [], citations as any);

    // Citation markers are preserved (converted to spans by rehypeCitations in markdown.tsx)
    expect(result).toContain("【†1†】");
    consoleSpy.mockRestore();
  });

  it("should strip related queries from text when present", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const relatedQueries = [
      { query: "What is CVE?", answer: "Common Vulnerabilities" },
    ];
    const text =
      "Main content\nRelated query: What is CVE? Answer: Common Vulnerabilities";
    const result = postProcessAgentText(text, relatedQueries as any, []);

    expect(result).toContain("Related Queries:");
    consoleSpy.mockRestore();
  });

  it("should handle empty text", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = postProcessAgentText("", [], []);
    expect(result).toBe("");
    consoleSpy.mockRestore();
  });
});
