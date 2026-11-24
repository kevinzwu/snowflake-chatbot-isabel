import {
  getFileTypeFromName,
  neutralizeCsvFormulas,
  sanitizeExtractedText,
  sanitizeFilename,
  scanDocxForThreats,
  scanPdfForThreats,
  validateFile,
  validateFileSize,
  validateMagicBytes,
} from "@/lib/security/file-validator";
import { describe, expect, it } from "vitest";

describe("file-validator", () => {
  describe("getFileTypeFromName", () => {
    it("should return pdf for .pdf files", () => {
      expect(getFileTypeFromName("report.pdf")).toBe("pdf");
    });

    it("should return csv for .csv files", () => {
      expect(getFileTypeFromName("data.csv")).toBe("csv");
    });

    it("should return docx for .docx files", () => {
      expect(getFileTypeFromName("document.docx")).toBe("docx");
    });

    it("should be case-insensitive", () => {
      expect(getFileTypeFromName("report.PDF")).toBe("pdf");
      expect(getFileTypeFromName("data.CSV")).toBe("csv");
      expect(getFileTypeFromName("doc.DOCX")).toBe("docx");
    });

    it("should return null for unsupported types", () => {
      expect(getFileTypeFromName("script.js")).toBeNull();
      expect(getFileTypeFromName("archive.zip")).toBeNull();
      expect(getFileTypeFromName("spreadsheet.xlsx")).toBeNull();
    });

    it("should return image for image file extensions", () => {
      expect(getFileTypeFromName("screenshot.png")).toBe("image");
      expect(getFileTypeFromName("photo.jpg")).toBe("image");
      expect(getFileTypeFromName("photo.jpeg")).toBe("image");
      expect(getFileTypeFromName("capture.webp")).toBe("image");
    });

    it("should return null for files without extension", () => {
      expect(getFileTypeFromName("noextension")).toBeNull();
    });
  });

  describe("validateFileSize", () => {
    it("should accept files within limit", () => {
      expect(validateFileSize(1024)).toBe(true);
      expect(validateFileSize(10 * 1024 * 1024)).toBe(true); // exactly 10 MB
    });

    it("should reject files over 10 MB", () => {
      expect(validateFileSize(10 * 1024 * 1024 + 1)).toBe(false);
    });

    it("should reject zero-size files", () => {
      expect(validateFileSize(0)).toBe(false);
    });

    it("should use 3.75MB limit for image files", () => {
      const justUnder = Math.floor(3.75 * 1024 * 1024);
      expect(validateFileSize(justUnder, "image")).toBe(true);
      expect(validateFileSize(justUnder + 1, "image")).toBe(false);
    });

    it("should use 10MB limit for non-image files", () => {
      expect(validateFileSize(5 * 1024 * 1024, "pdf")).toBe(true);
      expect(validateFileSize(10 * 1024 * 1024, "csv")).toBe(true);
    });
  });

  describe("validateMagicBytes", () => {
    it("should accept valid PDF magic bytes", () => {
      const pdfBuffer = Buffer.from("%PDF-1.5 some content", "utf-8");
      expect(validateMagicBytes(pdfBuffer, "pdf")).toBe(true);
    });

    it("should reject invalid PDF magic bytes", () => {
      const notPdf = Buffer.from("Not a PDF file", "utf-8");
      expect(validateMagicBytes(notPdf, "pdf")).toBe(false);
    });

    it("should accept valid DOCX magic bytes (ZIP signature)", () => {
      const docxHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
      expect(validateMagicBytes(docxHeader, "docx")).toBe(true);
    });

    it("should reject DOCX with wrong magic bytes", () => {
      const notDocx = Buffer.from("Not a DOCX", "utf-8");
      expect(validateMagicBytes(notDocx, "docx")).toBe(false);
    });

    it("should accept CSV with valid UTF-8 text content", () => {
      const csvBuffer = Buffer.from("Name,Value\nfoo,bar\n", "utf-8");
      expect(validateMagicBytes(csvBuffer, "csv")).toBe(true);
    });

    it("should reject ELF executable disguised as any type", () => {
      const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x00]);
      expect(validateMagicBytes(elf, "pdf")).toBe(false);
      expect(validateMagicBytes(elf, "csv")).toBe(false);
    });

    it("should reject PE/MZ executable", () => {
      const pe = Buffer.from([0x4d, 0x5a, 0x00, 0x00]);
      expect(validateMagicBytes(pe, "pdf")).toBe(false);
    });

    it("should reject shebang scripts", () => {
      const shebang = Buffer.from("#!/bin/bash\nrm -rf /", "utf-8");
      expect(validateMagicBytes(shebang, "csv")).toBe(false);
    });

    it("should reject empty buffer", () => {
      const empty = Buffer.alloc(0);
      expect(validateMagicBytes(empty, "pdf")).toBe(false);
    });

    it("should accept valid PNG magic bytes", () => {
      const png = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
      ]);
      expect(validateMagicBytes(png, "image")).toBe(true);
    });

    it("should accept valid JPEG magic bytes", () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      expect(validateMagicBytes(jpeg, "image")).toBe(true);
    });

    it("should accept valid WebP magic bytes", () => {
      // RIFF....WEBP
      const webp = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]);
      expect(validateMagicBytes(webp, "image")).toBe(true);
    });

    it("should reject image with mismatched magic bytes", () => {
      const notImage = Buffer.from("Not an image file", "utf-8");
      expect(validateMagicBytes(notImage, "image")).toBe(false);
    });
  });

  describe("scanPdfForThreats", () => {
    it("should pass clean PDF content", () => {
      const clean = Buffer.from(
        "%PDF-1.5\n1 0 obj\n<< /Type /Catalog >>\nendobj",
        "latin1",
      );
      expect(scanPdfForThreats(clean)).toEqual({ safe: true });
    });

    it("should allow non-auto-executing /S /JavaScript (benign for text extraction)", () => {
      // Non-auto-executing JavaScript actions (form validation, print scripts)
      // are harmless since we only extract text, never render the PDF.
      const benign = Buffer.from(
        "%PDF-1.5\n1 0 obj\n<< /S /JavaScript /JS (alert('xss')) >>\nendobj",
        "latin1",
      );
      expect(scanPdfForThreats(benign)).toEqual({ safe: true });
    });

    it("should not flag /JS without /S /JavaScript action type", () => {
      // A bare /JS without the action type indicator should not be flagged
      // because it can appear in font names, metadata, etc.
      const benign = Buffer.from(
        "%PDF-1.5\n/JS (some value)\nendobj",
        "latin1",
      );
      expect(scanPdfForThreats(benign)).toEqual({ safe: true });
    });

    it("should allow /S/JavaScript without space (non-auto-executing)", () => {
      const benign = Buffer.from(
        "%PDF-1.5\n1 0 obj\n<< /S/JavaScript /JS (code) >>\nendobj",
        "latin1",
      );
      expect(scanPdfForThreats(benign)).toEqual({ safe: true });
    });

    it("should detect /Launch actions in PDF", () => {
      const malicious = Buffer.from("%PDF-1.5\n/Launch /Action", "latin1");
      const result = scanPdfForThreats(malicious);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("launch actions");
    });

    it("should detect /EmbeddedFile in PDF", () => {
      const malicious = Buffer.from("%PDF-1.5\n/EmbeddedFile /Type", "latin1");
      const result = scanPdfForThreats(malicious);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("embedded files");
    });

    it("should pass clean PDF with compressed stream containing coincidental /S /JavaScript bytes", () => {
      // Simulate a FlateDecode stream whose raw bytes happen to contain
      // the character sequence /S /JavaScript — this must NOT trigger a match
      const pdf = Buffer.from(
        "%PDF-1.5\n1 0 obj\n<< /Type /Catalog >>\nendobj\n" +
          "2 0 obj\n<< /Length 40 /Filter /FlateDecode >>\nstream\n" +
          "/S /JavaScript /JS (alert('xss'))\n" +
          "endstream\nendobj",
        "latin1",
      );
      expect(scanPdfForThreats(pdf)).toEqual({ safe: true });
    });

    it("should allow non-auto-executing /S /JavaScript outside compressed streams", () => {
      // Non-auto-executing JavaScript outside streams is benign for text extraction
      const pdf = Buffer.from(
        "%PDF-1.5\n1 0 obj\n<< /S /JavaScript /JS (code) >>\nendobj",
        "latin1",
      );
      expect(scanPdfForThreats(pdf)).toEqual({ safe: true });
    });

    it("should detect /AA with /S /JavaScript outside streams", () => {
      const pdf = Buffer.from(
        "%PDF-1.5\n1 0 obj\n<< /AA << /O << /S /JavaScript /JS (code) >> >> >>\nendobj",
        "latin1",
      );
      const result = scanPdfForThreats(pdf);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("auto-executing JavaScript");
    });

    it("should pass /AA without JavaScript (GoTo action)", () => {
      const pdf = Buffer.from(
        "%PDF-1.5\n1 0 obj\n<< /AA << /O << /S /GoTo /D [0 /Fit] >> >> >>\nendobj",
        "latin1",
      );
      expect(scanPdfForThreats(pdf)).toEqual({ safe: true });
    });

    it("should detect /OpenAction with JavaScript", () => {
      const pdf = Buffer.from(
        "%PDF-1.5\n1 0 obj\n<< /OpenAction << /S /JavaScript /JS (code) >> >>\nendobj",
        "latin1",
      );
      const result = scanPdfForThreats(pdf);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("JavaScript open actions");
    });

    it("should pass /OpenAction without JavaScript", () => {
      const pdf = Buffer.from(
        "%PDF-1.5\n1 0 obj\n<< /OpenAction [0 /Fit] >>\nendobj",
        "latin1",
      );
      expect(scanPdfForThreats(pdf)).toEqual({ safe: true });
    });

    it("should detect /URI with javascript: scheme", () => {
      const pdf = Buffer.from(
        "%PDF-1.5\n1 0 obj\n<< /S /URI /URI (javascript:alert(1)) >>\nendobj",
        "latin1",
      );
      const result = scanPdfForThreats(pdf);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("JavaScript URIs");
    });

    it("should pass /URI with https: scheme", () => {
      const pdf = Buffer.from(
        "%PDF-1.5\n1 0 obj\n<< /S /URI /URI (https://example.com) >>\nendobj",
        "latin1",
      );
      expect(scanPdfForThreats(pdf)).toEqual({ safe: true });
    });
  });

  describe("neutralizeCsvFormulas", () => {
    it("should not modify normal values", () => {
      expect(neutralizeCsvFormulas("hello")).toBe("hello");
      expect(neutralizeCsvFormulas("123")).toBe("123");
      expect(neutralizeCsvFormulas("")).toBe("");
    });

    it("should prefix = with apostrophe", () => {
      expect(neutralizeCsvFormulas("=CMD()")).toBe("'=CMD()");
    });

    it("should prefix + with apostrophe", () => {
      expect(neutralizeCsvFormulas("+1234")).toBe("'+1234");
    });

    it("should prefix - with apostrophe", () => {
      expect(neutralizeCsvFormulas("-1+1")).toBe("'-1+1");
    });

    it("should prefix @ with apostrophe", () => {
      expect(neutralizeCsvFormulas("@SUM(A1)")).toBe("'@SUM(A1)");
    });

    it("should handle values with leading whitespace before formula char", () => {
      expect(neutralizeCsvFormulas("  =CMD()")).toBe("'  =CMD()");
    });
  });

  describe("sanitizeExtractedText", () => {
    it("should strip HTML tags", () => {
      expect(sanitizeExtractedText("<p>Hello</p><br/>World")).toBe(
        "HelloWorld",
      );
    });

    it("should remove null bytes", () => {
      expect(sanitizeExtractedText("Hello\x00World")).toBe("HelloWorld");
    });

    it("should remove control characters except newline, tab, carriage return", () => {
      expect(sanitizeExtractedText("Hello\x01\x02\x03World")).toBe(
        "HelloWorld",
      );
      // Preserve tab, newline, carriage return
      expect(sanitizeExtractedText("Hello\t\n\rWorld")).toBe(
        "Hello\t\n\rWorld",
      );
    });

    it("should handle combined dangerous content", () => {
      const input = "<script>alert(1)</script>\x00Hello\x01World\nOK";
      const result = sanitizeExtractedText(input);
      expect(result).toBe("alert(1)HelloWorld\nOK");
    });

    it("should handle empty string", () => {
      expect(sanitizeExtractedText("")).toBe("");
    });
  });

  describe("validateFile", () => {
    it("should accept a valid PDF", async () => {
      const pdfBuffer = Buffer.from(
        "%PDF-1.5\n1 0 obj\n<< /Type /Catalog >>\nendobj",
        "utf-8",
      );
      const result = await validateFile(pdfBuffer, "report.pdf");
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.fileType).toBe("pdf");
    });

    it("should accept a valid CSV", async () => {
      const csvBuffer = Buffer.from("Name,Value\nfoo,bar\n", "utf-8");
      const result = await validateFile(csvBuffer, "data.csv");
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.fileType).toBe("csv");
    });

    it("should reject unsupported file types", async () => {
      const buffer = Buffer.from("some content", "utf-8");
      const result = await validateFile(buffer, "script.js");
      expect(result.valid).toBe(false);
      expect(result.valid === false && result.error).toContain(
        "Unsupported file type",
      );
      expect(result).not.toHaveProperty("fileType");
    });

    it("should reject empty files", async () => {
      const buffer = Buffer.alloc(0);
      const result = await validateFile(buffer, "empty.pdf");
      expect(result.valid).toBe(false);
      expect(result.valid === false && result.error).toContain("empty");
      expect(result).not.toHaveProperty("fileType");
    });

    it("should reject oversized files", async () => {
      const buffer = Buffer.alloc(10 * 1024 * 1024 + 1);
      const result = await validateFile(buffer, "huge.pdf");
      expect(result.valid).toBe(false);
      expect(result.valid === false && result.error).toContain("10 MB");
      expect(result).not.toHaveProperty("fileType");
    });

    it("should reject mismatched magic bytes", async () => {
      const buffer = Buffer.from("Not a PDF at all", "utf-8");
      const result = await validateFile(buffer, "fake.pdf");
      expect(result.valid).toBe(false);
      expect(result.valid === false && result.error).toContain(
        "does not match",
      );
      expect(result).not.toHaveProperty("fileType");
    });

    it("should reject dangerous executables", async () => {
      const elf = Buffer.alloc(100);
      elf[0] = 0x7f;
      elf[1] = 0x45;
      elf[2] = 0x4c;
      elf[3] = 0x46;
      const result = await validateFile(elf, "malware.pdf");
      expect(result.valid).toBe(false);
      expect(result.valid === false && result.error).toContain("dangerous");
      expect(result).not.toHaveProperty("fileType");
    });

    it("should reject PDF with auto-executing JavaScript (/AA)", async () => {
      const maliciousPdf = Buffer.from(
        "%PDF-1.5\n1 0 obj\n<< /AA << /O << /S /JavaScript /JS (alert('xss')) >> >> >>\nendobj",
        "utf-8",
      );
      const result = await validateFile(maliciousPdf, "exploit.pdf");
      expect(result.valid).toBe(false);
      expect(result.valid === false && result.error).toContain("JavaScript");
      expect(result).not.toHaveProperty("fileType");
    });

    it("should accept PDF with non-auto-executing JavaScript", async () => {
      const benignPdf = Buffer.from(
        "%PDF-1.5\n1 0 obj\n<< /S /JavaScript /JS (print()) >>\nendobj",
        "utf-8",
      );
      const result = await validateFile(benignPdf, "form.pdf");
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.fileType).toBe("pdf");
    });
  });

  describe("scanDocxForThreats", () => {
    it("should reject DOCX with OLE-named embedded object", async () => {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      zip.file("[Content_Types].xml", "<Types></Types>");
      zip.file("word/document.xml", "<document/>");
      zip.file("word/embeddings/oleObject1.bin", "embedded-content");
      const buffer = Buffer.from(
        await zip.generateAsync({ type: "nodebuffer" }),
      );
      const result = await scanDocxForThreats(buffer);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("embedded objects");
    });

    it("should reject DOCX with non-OLE-named embedded object", async () => {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      zip.file("[Content_Types].xml", "<Types></Types>");
      zip.file("word/document.xml", "<document/>");
      zip.file(
        "word/embeddings/Microsoft_Excel_Worksheet1.xlsx",
        "spreadsheet-data",
      );
      const buffer = Buffer.from(
        await zip.generateAsync({ type: "nodebuffer" }),
      );
      const result = await scanDocxForThreats(buffer);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("embedded objects");
    });

    it("should pass DOCX with no embeddings", async () => {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      zip.file("[Content_Types].xml", "<Types></Types>");
      zip.file("word/document.xml", "<document/>");
      const buffer = Buffer.from(
        await zip.generateAsync({ type: "nodebuffer" }),
      );
      const result = await scanDocxForThreats(buffer);
      expect(result.safe).toBe(true);
    });
  });

  describe("sanitizeFilename", () => {
    it("should strip path separators", () => {
      expect(sanitizeFilename("../../etc/passwd.pdf")).toBe(
        "..-..-etc-passwd.pdf",
      );
    });

    it("should remove control characters", () => {
      expect(sanitizeFilename("file\x00name\x0A.pdf")).toBe("filename.pdf");
    });

    it("should cap length at 255 while preserving extension", () => {
      const longName = "a".repeat(300) + ".pdf";
      const result = sanitizeFilename(longName);
      expect(result.length).toBe(255);
      expect(result.endsWith(".pdf")).toBe(true);
    });

    it("should cap length at 255 without extension", () => {
      const longName = "a".repeat(300);
      const result = sanitizeFilename(longName);
      expect(result.length).toBe(255);
    });

    it("should return 'unnamed' for empty input after sanitization", () => {
      expect(sanitizeFilename("\x00\x01")).toBe("unnamed");
    });

    it("should normalize Unicode to NFC", () => {
      // é as two code points (e + combining accent) vs single code point
      const decomposed = "e\u0301.pdf";
      const result = sanitizeFilename(decomposed);
      expect(result).toBe("\u00e9.pdf");
    });

    it("should handle normal filenames unchanged", () => {
      expect(sanitizeFilename("report.pdf")).toBe("report.pdf");
      expect(sanitizeFilename("data-export.csv")).toBe("data-export.csv");
    });
  });
});
