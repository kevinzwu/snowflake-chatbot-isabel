import { describe, expect, it } from "vitest";
import {
  containsDangerousContent,
  MAX_INPUT_LENGTH,
  normalizeEncodings,
  sanitizeForStorage,
  sanitizeInput,
  stripMarkdownFormatting,
  validateChatInput,
} from "./input-sanitizer";

describe("input-sanitizer", () => {
  describe("normalizeEncodings", () => {
    it("should return empty string for null/undefined", () => {
      expect(normalizeEncodings(null as unknown as string)).toBe("");
      expect(normalizeEncodings(undefined as unknown as string)).toBe("");
    });

    it("should decode URL-encoded content", () => {
      expect(normalizeEncodings("%3Cscript%3E")).toBe("<script>");
      expect(normalizeEncodings("%3C%73%63%72%69%70%74%3E")).toBe("<script>");
    });

    it("should decode double URL-encoded content", () => {
      expect(normalizeEncodings("%253Cscript%253E")).toBe("<script>");
    });

    it("should decode HTML entities", () => {
      expect(normalizeEncodings("&lt;script&gt;")).toBe("<script>");
      expect(normalizeEncodings("&amp;lt;")).toBe("&lt;");
    });

    it("should decode numeric HTML entities", () => {
      expect(normalizeEncodings("&#60;script&#62;")).toBe("<script>");
      expect(normalizeEncodings("&#x3C;script&#x3E;")).toBe("<script>");
    });

    it("should decode JavaScript Unicode escapes", () => {
      expect(normalizeEncodings("\\u003cscript\\u003e")).toBe("<script>");
    });

    it("should handle mixed encodings", () => {
      expect(normalizeEncodings("%26lt;")).toBe("<");
    });

    it("should preserve normal text", () => {
      expect(normalizeEncodings("Hello World")).toBe("Hello World");
    });
  });

  describe("stripMarkdownFormatting", () => {
    it("should return empty string for null/undefined", () => {
      expect(stripMarkdownFormatting(null as unknown as string)).toBe("");
      expect(stripMarkdownFormatting(undefined as unknown as string)).toBe("");
    });

    it("should preserve normal text", () => {
      expect(stripMarkdownFormatting("Hello World")).toBe("Hello World");
    });

    describe("headers", () => {
      it("should remove h1 headers", () => {
        expect(stripMarkdownFormatting("# Header")).toBe("Header");
      });

      it("should remove h2 headers", () => {
        expect(stripMarkdownFormatting("## Header")).toBe("Header");
      });

      it("should remove h3-h6 headers", () => {
        expect(stripMarkdownFormatting("### Header")).toBe("Header");
        expect(stripMarkdownFormatting("#### Header")).toBe("Header");
        expect(stripMarkdownFormatting("##### Header")).toBe("Header");
        expect(stripMarkdownFormatting("###### Header")).toBe("Header");
      });

      it("should preserve text after headers", () => {
        expect(stripMarkdownFormatting("## Title\nSome content")).toBe(
          "Title\nSome content",
        );
      });
    });

    describe("bold and italic", () => {
      it("should remove bold asterisks", () => {
        expect(stripMarkdownFormatting("**bold text**")).toBe("bold text");
      });

      it("should remove bold underscores", () => {
        expect(stripMarkdownFormatting("__bold text__")).toBe("bold text");
      });

      it("should remove italic asterisks", () => {
        expect(stripMarkdownFormatting("*italic text*")).toBe("italic text");
      });

      it("should remove italic underscores", () => {
        expect(stripMarkdownFormatting("_italic text_")).toBe("italic text");
      });

      it("should remove bold italic", () => {
        expect(stripMarkdownFormatting("***bold italic***")).toBe(
          "bold italic",
        );
        expect(stripMarkdownFormatting("___bold italic___")).toBe(
          "bold italic",
        );
      });

      it("should preserve snake_case", () => {
        expect(stripMarkdownFormatting("some_variable_name")).toBe(
          "some_variable_name",
        );
      });
    });

    describe("links and images", () => {
      it("should remove links keeping text", () => {
        expect(
          stripMarkdownFormatting("[link text](https://example.com)"),
        ).toBe("link text");
      });

      it("should remove images keeping alt text", () => {
        expect(stripMarkdownFormatting("![alt text](image.png)")).toBe(
          "alt text",
        );
      });

      it("should handle empty link text", () => {
        expect(stripMarkdownFormatting("[](https://example.com)")).toBe("");
      });
    });

    describe("code", () => {
      it("should remove inline code backticks", () => {
        expect(stripMarkdownFormatting("`code`")).toBe("code");
      });

      it("should remove code blocks", () => {
        expect(stripMarkdownFormatting("```\ncode block\n```")).toBe(
          "code block",
        );
      });
    });

    describe("lists", () => {
      it("should remove unordered list markers", () => {
        expect(stripMarkdownFormatting("- item")).toBe("item");
        expect(stripMarkdownFormatting("* item")).toBe("item");
        expect(stripMarkdownFormatting("+ item")).toBe("item");
      });

      it("should remove ordered list markers", () => {
        expect(stripMarkdownFormatting("1. first")).toBe("first");
        expect(stripMarkdownFormatting("2. second")).toBe("second");
        expect(stripMarkdownFormatting("10. tenth")).toBe("tenth");
      });
    });

    describe("other", () => {
      it("should remove blockquotes", () => {
        expect(stripMarkdownFormatting("> quoted text")).toBe("quoted text");
      });

      it("should remove strikethrough", () => {
        expect(stripMarkdownFormatting("~~strikethrough~~")).toBe(
          "strikethrough",
        );
      });

      it("should remove horizontal rules", () => {
        expect(stripMarkdownFormatting("---")).toBe("");
        expect(stripMarkdownFormatting("***")).toBe("");
        expect(stripMarkdownFormatting("___")).toBe("");
      });
    });
  });

  describe("sanitizeInput", () => {
    it("should return empty string for null/undefined", () => {
      expect(sanitizeInput(null as unknown as string)).toBe("");
      expect(sanitizeInput(undefined as unknown as string)).toBe("");
    });

    it("should return empty string for non-string input", () => {
      expect(sanitizeInput(123 as unknown as string)).toBe("");
      expect(sanitizeInput({} as unknown as string)).toBe("");
    });

    it("should preserve normal text", () => {
      const normalText = "What are the current open vulnerabilities?";
      expect(sanitizeInput(normalText)).toBe(normalText);
    });

    it("should preserve multiline text structure", () => {
      const multiline = "Line 1\nLine 2\n\nLine 3";
      expect(sanitizeInput(multiline)).toBe("Line 1\nLine 2\n\nLine 3");
    });

    describe("HTML tag removal", () => {
      it("should remove script tags and content", () => {
        expect(sanitizeInput('<script>alert("xss")</script>Hello')).toBe(
          "Hello",
        );
        expect(sanitizeInput('<script src="evil.js"></script>Test')).toBe(
          "Test",
        );
      });

      it("should remove style tags and content", () => {
        expect(
          sanitizeInput("<style>body { background: red; }</style>Content"),
        ).toBe("Content");
      });

      it("should remove SVG elements", () => {
        expect(
          sanitizeInput('<svg onload="alert(1)"><circle/></svg>Safe'),
        ).toBe("Safe");
      });

      it("should remove img tags", () => {
        expect(sanitizeInput('<img src="x" onerror="alert(1)">Text')).toBe(
          "Text",
        );
      });

      it("should remove iframe tags", () => {
        expect(sanitizeInput('<iframe src="evil.html"></iframe>Safe')).toBe(
          "Safe",
        );
      });

      it("should remove self-closing tags", () => {
        expect(sanitizeInput("<br/>Line break")).toBe("Line break");
        expect(sanitizeInput("<hr />Horizontal rule")).toBe("Horizontal rule");
      });

      it("should remove HTML comments", () => {
        expect(sanitizeInput("Before<!-- comment -->After")).toBe(
          "BeforeAfter",
        );
        expect(
          sanitizeInput("Before<!-- <script>alert(1)</script> -->After"),
        ).toBe("BeforeAfter");
      });

      it("should handle multiple nested tags", () => {
        expect(sanitizeInput("<div><span><b>Text</b></span></div>")).toBe(
          "Text",
        );
      });
    });

    describe("JavaScript injection prevention", () => {
      it("should remove javascript: URIs in markdown links", () => {
        // Markdown links are stripped completely, keeping only link text
        expect(sanitizeInput("[click](javascript:alert(1))")).toBe("click");
        expect(sanitizeInput("[xss](javascript:document.cookie)")).toBe("xss");
      });

      it("should remove javascript: URIs in markdown images", () => {
        // Markdown images stripped, keeping alt text
        expect(sanitizeInput("![img](javascript:alert(1))")).toBe("img");
      });

      it("should remove vbscript: URIs", () => {
        expect(sanitizeInput("[click](vbscript:msgbox(1))")).toBe("click");
      });

      it("should remove data: URIs in markdown", () => {
        expect(
          sanitizeInput("[click](data:text/html,<script>alert(1)</script>)"),
        ).toBe("click");
      });

      it("should remove event handlers", () => {
        expect(sanitizeInput('onclick="alert(1)"')).toBe("");
        expect(sanitizeInput("onmouseover='alert(1)'")).toBe("");
        expect(sanitizeInput('onerror="alert(1)"')).toBe("");
      });

      it("should handle mixed case event handlers", () => {
        expect(sanitizeInput('onClick="alert(1)"')).toBe("");
        expect(sanitizeInput('OnLoAd="alert(1)"')).toBe("");
      });
    });

    describe("encoding bypass prevention", () => {
      it("should sanitize URL-encoded XSS attempts", () => {
        expect(sanitizeInput("%3Cscript%3Ealert(1)%3C/script%3E")).toBe("");
      });

      it("should sanitize double URL-encoded XSS attempts", () => {
        expect(sanitizeInput("%253Cscript%253Ealert(1)%253C/script%253E")).toBe(
          "",
        );
      });

      it("should sanitize HTML entity encoded XSS attempts", () => {
        expect(sanitizeInput("&lt;script&gt;alert(1)&lt;/script&gt;")).toBe("");
      });

      it("should sanitize Unicode escaped XSS attempts", () => {
        expect(
          sanitizeInput("\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"),
        ).toBe("");
      });

      it("should sanitize mixed encoding XSS attempts", () => {
        // URL encoded < with HTML entity >
        expect(sanitizeInput("%3Cscript&gt;alert(1)%3C/script&gt;")).toBe("");
      });
    });

    describe("whitespace normalization", () => {
      it("should collapse multiple spaces", () => {
        expect(sanitizeInput("Hello    World")).toBe("Hello World");
      });

      it("should collapse excessive newlines", () => {
        expect(sanitizeInput("Line1\n\n\n\n\nLine2")).toBe("Line1\n\nLine2");
      });

      it("should trim leading and trailing whitespace", () => {
        expect(sanitizeInput("   Hello World   ")).toBe("Hello World");
      });
    });

    describe("complex attack patterns", () => {
      it("should handle nested script injection attempts", () => {
        // DOMPurify handles this more robustly than regex
        const result = sanitizeInput(
          "<scr<script>ipt>alert(1)</scr</script>ipt>",
        );
        // Should not contain any script-like content
        expect(result.toLowerCase()).not.toContain("script");
      });

      it("should handle javascript: URI in plain text", () => {
        expect(sanitizeInput("javascript:alert(1)")).toBe("");
      });

      it("should handle encoded characters in tags", () => {
        expect(sanitizeInput("<script&#32;>alert(1)</script>")).toBe("");
      });

      it("should handle mutation XSS attempts", () => {
        // DOMPurify strips noscript tags but preserves safe text content
        // The text "alert(1)" alone is harmless - it's only dangerous in HTML context
        expect(sanitizeInput("<noscript><noscript/>alert(1)")).toBe("alert(1)");
      });
    });
  });

  describe("validateChatInput", () => {
    it("should return valid for normal input", () => {
      const result = validateChatInput(
        "What are the current open vulnerabilities?",
      );
      expect(result.isValid).toBe(true);
      expect(result.sanitizedInput).toBe(
        "What are the current open vulnerabilities?",
      );
      expect(result.error).toBeUndefined();
      expect(result.hadDangerousContent).toBe(false);
    });

    it("should return invalid for null input", () => {
      const result = validateChatInput(null as unknown as string);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Input is required");
    });

    it("should return invalid for undefined input", () => {
      const result = validateChatInput(undefined as unknown as string);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Input is required");
    });

    it("should return invalid for non-string input", () => {
      const result = validateChatInput(123 as unknown as string);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Input must be a string");
    });

    it("should return invalid for empty input after trimming", () => {
      const result = validateChatInput("   ");
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Please enter a message");
    });

    it("should return invalid for input that becomes empty after sanitization", () => {
      const result = validateChatInput("<script>alert(1)</script>");
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Please enter a message");
      expect(result.hadDangerousContent).toBe(true);
    });

    it("should handle input at exactly max length", () => {
      const longInput = "a".repeat(MAX_INPUT_LENGTH);
      const result = validateChatInput(longInput);
      expect(result.isValid).toBe(true);
    });

    it("should return invalid for input exceeding max length", () => {
      const tooLongInput = "a".repeat(MAX_INPUT_LENGTH + 1);
      const result = validateChatInput(tooLongInput);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("exceeds maximum length");
    });

    it("should return invalid for extremely long input (pre-sanitization check)", () => {
      const extremelyLong = "a".repeat(MAX_INPUT_LENGTH * 3);
      const result = validateChatInput(extremelyLong);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("exceeds maximum length");
    });

    it("should sanitize and return valid input with XSS attempt", () => {
      const result = validateChatInput(
        "<script>alert(1)</script>Show me vulnerabilities",
      );
      expect(result.isValid).toBe(true);
      expect(result.sanitizedInput).toBe("Show me vulnerabilities");
      expect(result.hadDangerousContent).toBe(true);
    });

    it("should sanitize markdown XSS and return valid", () => {
      const result = validateChatInput(
        "Check [this link](javascript:alert(1)) please",
      );
      expect(result.isValid).toBe(true);
      // Markdown links are completely stripped, keeping only the link text
      expect(result.sanitizedInput).toBe("Check this link please");
      expect(result.hadDangerousContent).toBe(true);
    });

    it("should flag encoded XSS attempts as dangerous", () => {
      const result = validateChatInput(
        "%3Cscript%3Ealert(1)%3C/script%3EHello",
      );
      expect(result.isValid).toBe(true);
      expect(result.sanitizedInput).toBe("Hello");
      expect(result.hadDangerousContent).toBe(true);
    });
  });

  describe("containsDangerousContent", () => {
    it("should return false for null/undefined", () => {
      expect(containsDangerousContent(null as unknown as string)).toBe(false);
      expect(containsDangerousContent(undefined as unknown as string)).toBe(
        false,
      );
    });

    it("should return false for normal text", () => {
      expect(containsDangerousContent("Hello world")).toBe(false);
      expect(
        containsDangerousContent("What are the current vulnerabilities?"),
      ).toBe(false);
    });

    it("should detect script tags", () => {
      expect(containsDangerousContent('<script>alert("xss")</script>')).toBe(
        true,
      );
    });

    it("should detect SVG elements", () => {
      expect(containsDangerousContent('<svg onload="alert(1)"></svg>')).toBe(
        true,
      );
    });

    it("should detect event handlers", () => {
      expect(containsDangerousContent('onclick="alert(1)"')).toBe(true);
      expect(containsDangerousContent("onmouseover='evil()'")).toBe(true);
    });

    it("should detect dangerous URIs in markdown links", () => {
      expect(containsDangerousContent("[click](javascript:alert(1))")).toBe(
        true,
      );
      expect(containsDangerousContent("![img](javascript:alert(1))")).toBe(
        true,
      );
    });

    it("should detect dangerous standalone URIs", () => {
      expect(containsDangerousContent("javascript:alert(1)")).toBe(true);
      expect(containsDangerousContent("vbscript:msgbox(1)")).toBe(true);
    });

    it("should detect CSS expression patterns", () => {
      expect(containsDangerousContent("expression(alert(1))")).toBe(true);
      expect(containsDangerousContent("behavior:url(evil.htc)")).toBe(true);
    });

    it("should detect suspicious base64 data URIs", () => {
      const longBase64 = "data:text/html;base64," + "A".repeat(100);
      expect(containsDangerousContent(longBase64)).toBe(true);
    });

    it("should detect URL-encoded XSS attempts", () => {
      expect(
        containsDangerousContent("%3Cscript%3Ealert(1)%3C/script%3E"),
      ).toBe(true);
    });

    it("should detect HTML entity encoded XSS attempts", () => {
      expect(
        containsDangerousContent("&lt;script&gt;alert(1)&lt;/script&gt;"),
      ).toBe(true);
    });

    it("should handle multiple calls without regex state issues", () => {
      // This tests that lastIndex is properly reset
      const input = "<script>alert(1)</script>";
      expect(containsDangerousContent(input)).toBe(true);
      expect(containsDangerousContent(input)).toBe(true);
      expect(containsDangerousContent(input)).toBe(true);
    });
  });

  describe("sanitizeForStorage", () => {
    it("should return empty string for null/undefined", () => {
      expect(sanitizeForStorage(null)).toEqual({ value: "", isValid: true });
      expect(sanitizeForStorage(undefined)).toEqual({
        value: "",
        isValid: true,
      });
    });

    it("should return error for non-string input", () => {
      const result = sanitizeForStorage(123, "testField");
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("testField must be a string");
    });

    it("should sanitize and return valid string", () => {
      const result = sanitizeForStorage("<script>alert(1)</script>Hello");
      expect(result.isValid).toBe(true);
      expect(result.value).toBe("Hello");
    });

    it("should use default field name in error", () => {
      const result = sanitizeForStorage(123);
      expect(result.error).toBe("value must be a string");
    });
  });
});
