import { describe, expect, it } from "vitest";
import {
  injectProfileCleared,
  injectProfileContent,
} from "../injectProfileContent";

describe("injectProfileContent", () => {
  it("should prepend profile block to agent input", () => {
    const result = injectProfileContent(
      "show me open vulns",
      "SDL Team Lead",
      "Focus on SDL-SECENG. Use bullet points.",
    );

    expect(result).toBe(
      "[User Profile: SDL Team Lead]\nFocus on SDL-SECENG. Use bullet points.\n---\nshow me open vulns",
    );
  });

  it("should work with input that already has file context", () => {
    const inputWithFileContext =
      "[Attached File: report.pdf, 5 pages]\n---\nextracted text\n---\nanalyze this";
    const result = injectProfileContent(
      inputWithFileContext,
      "Security Manager",
      "Show rewards as tables.",
    );

    expect(result).toContain("[User Profile: Security Manager]");
    expect(result).toContain("Show rewards as tables.");
    expect(result).toContain("[Attached File: report.pdf, 5 pages]");
    expect(result.endsWith(inputWithFileContext)).toBe(true);
  });

  it("should handle empty user message", () => {
    const result = injectProfileContent(
      "",
      "My Profile",
      "Always respond concisely.",
    );

    expect(result).toBe(
      "[User Profile: My Profile]\nAlways respond concisely.\n---\n",
    );
  });
});

describe("injectProfileCleared", () => {
  it("should prepend clear message to agent input", () => {
    const result = injectProfileCleared("what are the latest vulns?");

    expect(result).toBe(
      "[User Profile cleared — respond without previous profile preferences]\n---\nwhat are the latest vulns?",
    );
  });

  it("should work with empty input", () => {
    const result = injectProfileCleared("");

    expect(result).toBe(
      "[User Profile cleared — respond without previous profile preferences]\n---\n",
    );
  });
});
