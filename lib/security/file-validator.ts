/**
 * File security validation for uploaded files.
 *
 * Multi-layer validation pipeline:
 * 1. Magic byte verification (structural integrity)
 * 2. Content safety scanning (macros, scripts, OLE objects)
 * 3. Extracted text sanitization
 */

import JSZip from "jszip";

// --- Types ---

export type AllowedFileType = "pdf" | "csv" | "docx" | "image";

export interface FileValidationSuccess {
  valid: true;
  fileType: AllowedFileType;
}

export interface FileValidationError {
  valid: false;
  error: string;
}

export type FileValidationResult = FileValidationSuccess | FileValidationError;

// --- Constants ---

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_IMAGE_SIZE = 3.75 * 1024 * 1024; // 3.75 MB (Claude vision limit via Cortex)

/** Magic byte signatures for supported file types */
const MAGIC_BYTES: Record<string, { bytes: number[]; offset: number }[]> = {
  pdf: [{ bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], offset: 0 }], // %PDF-
  docx: [{ bytes: [0x50, 0x4b, 0x03, 0x04], offset: 0 }], // PK\x03\x04 (ZIP)
  image: [
    { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], offset: 0 }, // PNG
    { bytes: [0xff, 0xd8, 0xff], offset: 0 }, // JPEG
  ],
};

/** Executable/script magic bytes to reject */
const DANGEROUS_SIGNATURES: {
  bytes: number[];
  offset: number;
  name: string;
}[] = [
  { bytes: [0x7f, 0x45, 0x4c, 0x46], offset: 0, name: "ELF executable" },
  { bytes: [0x4d, 0x5a], offset: 0, name: "PE/MZ executable" },
  { bytes: [0x23, 0x21], offset: 0, name: "Shebang script" }, // #!
];

/** PDF patterns mapped to their error messages.
 * Patterns are applied to uncompressed PDF object syntax only — compressed
 * stream data is stripped before scanning to avoid false positives from
 * arbitrary byte sequences. The `/JS` key is only dangerous when paired with
 * a `/JavaScript` action type — scanning for `/JS` alone causes false
 * positives on fonts, metadata, and compressed streams.
 *
 * Only auto-executing JavaScript (/AA, /OpenAction) is blocked. Non-auto-executing
 * `/S /JavaScript` actions (form validation, print scripts, named actions) are
 * benign for text extraction — we never render or execute PDF content. Blocking
 * all `/S /JavaScript` causes false positives on PDFs from common tools
 * (Adobe Acrobat, security scanners, document management systems). */
const PDF_DANGEROUS_PATTERNS: { pattern: RegExp; message: string }[] = [
  {
    pattern: /\/AA\b[\s\S]*?\/S\s*\/JavaScript/,
    message:
      "PDF contains auto-executing JavaScript actions which are not allowed",
  },
  {
    pattern: /\/OpenAction\b[\s\S]*?\/S\s*\/JavaScript/,
    message: "PDF contains JavaScript open actions which are not allowed",
  },
  {
    pattern: /\/URI\s*\(javascript:/i,
    message: "PDF contains JavaScript URIs which are not allowed",
  },
  {
    pattern: /\/Launch\b/,
    message: "PDF contains launch actions which are not allowed",
  },
  {
    pattern: /\/EmbeddedFile\b/,
    message: "PDF contains embedded files which are not allowed",
  },
];

/** CSV formula injection prefixes */
const CSV_FORMULA_PREFIXES = ["=", "+", "-", "@"];

// --- Filename sanitization ---

const MAX_FILENAME_LENGTH = 255;

export function sanitizeFilename(filename: string): string {
  // Strip path components
  let sanitized = filename.replace(/[/\\]/g, "-");

  // Remove control characters (U+0000–U+001F, U+007F)
  sanitized = sanitized.replace(/[\x00-\x1f\x7f]/g, "");

  // Normalize Unicode to NFC
  sanitized = sanitized.normalize("NFC");

  // Trim whitespace
  sanitized = sanitized.trim();

  // Cap length while preserving extension
  if (sanitized.length > MAX_FILENAME_LENGTH) {
    const dotIndex = sanitized.lastIndexOf(".");
    if (dotIndex >= 0) {
      const ext = sanitized.slice(dotIndex);
      const baseTruncated = sanitized.slice(
        0,
        MAX_FILENAME_LENGTH - ext.length,
      );
      sanitized = baseTruncated + ext;
    } else {
      sanitized = sanitized.slice(0, MAX_FILENAME_LENGTH);
    }
  }

  // Fallback for empty result
  if (!sanitized) {
    sanitized = "unnamed";
  }

  return sanitized;
}

// --- Extension → FileType mapping ---

const EXTENSION_MAP: Record<string, AllowedFileType> = {
  ".pdf": "pdf",
  ".csv": "csv",
  ".docx": "docx",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
};

export function getFileTypeFromName(filename: string): AllowedFileType | null {
  const ext =
    filename.lastIndexOf(".") >= 0
      ? filename.slice(filename.lastIndexOf(".")).toLowerCase()
      : "";
  return EXTENSION_MAP[ext] ?? null;
}

// --- Magic byte validation ---

function matchesBytes(
  buffer: Buffer,
  signature: { bytes: number[]; offset: number },
): boolean {
  if (buffer.length < signature.offset + signature.bytes.length) return false;
  return signature.bytes.every(
    (byte, i) => buffer[signature.offset + i] === byte,
  );
}

export function validateMagicBytes(
  buffer: Buffer,
  fileType: AllowedFileType,
): boolean {
  // Check for dangerous executable signatures first
  for (const sig of DANGEROUS_SIGNATURES) {
    if (matchesBytes(buffer, sig)) {
      return false;
    }
  }

  // CSV has no magic bytes — validate it's valid UTF-8 text
  if (fileType === "csv") {
    return isValidUtf8Text(buffer);
  }

  // WebP has split magic bytes: RIFF at offset 0, WEBP at offset 8
  if (fileType === "image") {
    const isWebP =
      matchesBytes(buffer, { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }) &&
      matchesBytes(buffer, { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 });
    if (isWebP) return true;
    // Fall through to standard magic byte check for PNG/JPEG
  }

  const signatures = MAGIC_BYTES[fileType];
  if (!signatures) return false;

  return signatures.some((sig) => matchesBytes(buffer, sig));
}

function isValidUtf8Text(buffer: Buffer): boolean {
  try {
    const text = buffer.toString("utf-8");
    // Check for non-text binary content (high ratio of non-printable chars)
    let nonPrintable = 0;
    const sampleSize = Math.min(text.length, 8192);
    for (let i = 0; i < sampleSize; i++) {
      const code = text.charCodeAt(i);
      if (
        code < 32 &&
        code !== 9 && // tab
        code !== 10 && // newline
        code !== 13 // carriage return
      ) {
        nonPrintable++;
      }
    }
    // If more than 5% non-printable, likely binary
    return nonPrintable / sampleSize < 0.05;
  } catch {
    return false;
  }
}

// --- File size validation ---

export function validateFileSize(
  size: number,
  fileType?: AllowedFileType,
): boolean {
  const limit = fileType === "image" ? MAX_IMAGE_SIZE : MAX_FILE_SIZE;
  return size > 0 && size <= limit;
}

// --- DOCX macro/OLE scanning ---

export async function scanDocxForThreats(
  buffer: Buffer,
): Promise<{ safe: boolean; reason?: string }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return { safe: false, reason: "File is not a valid DOCX (ZIP) archive" };
  }

  // Check for Content_Types.xml (required in valid DOCX)
  const hasContentTypes = zip.file("[Content_Types].xml") !== null;
  if (!hasContentTypes) {
    return { safe: false, reason: "File content does not match declared type" };
  }

  // Check for VBA macros
  if (
    zip.file("word/vbaProject.bin") !== null ||
    zip.file("vbaProject.bin") !== null
  ) {
    return {
      safe: false,
      reason: "File contains VBA macros which are not allowed",
    };
  }

  // Check for embedded objects (reject any entry under word/embeddings/)
  const embeddedFiles = Object.keys(zip.files).filter((name) =>
    name.startsWith("word/embeddings/"),
  );
  if (embeddedFiles.length > 0) {
    return {
      safe: false,
      reason: "File contains embedded objects which are not allowed",
    };
  }

  // Check XML parts for script tags
  const xmlFiles = Object.keys(zip.files).filter(
    (name) => name.endsWith(".xml") || name.endsWith(".rels"),
  );
  for (const xmlFile of xmlFiles) {
    const content = await zip.file(xmlFile)?.async("string");
    if (content && /<script[\s>]/i.test(content)) {
      return {
        safe: false,
        reason: "File contains script content which is not allowed",
      };
    }
  }

  return { safe: true };
}

// --- PDF security scanning ---

/** Strip compressed stream content from PDF text.
 * PDF spec (ISO 32000 §7.3.8): streams are delimited by
 * `stream\r\n` or `stream\n` ... `endstream`.
 * Removing these regions ensures pattern matching only scans
 * object-level syntax (dictionaries, names) where action
 * definitions actually live. */
function stripCompressedStreams(content: string): string {
  return content.replace(/stream\r?\n[\s\S]*?endstream/g, "");
}

export function scanPdfForThreats(buffer: Buffer): {
  safe: boolean;
  reason?: string;
} {
  // Read raw PDF content as string for pattern matching
  const raw = buffer.toString("latin1");

  // Strip compressed stream data to avoid false positives from
  // arbitrary byte sequences matching dangerous patterns
  const content = stripCompressedStreams(raw);

  for (const { pattern, message } of PDF_DANGEROUS_PATTERNS) {
    if (pattern.test(content)) {
      return { safe: false, reason: message };
    }
  }

  return { safe: true };
}

// --- CSV formula injection neutralization ---

export function neutralizeCsvFormulas(value: string): string {
  const trimmed = value.trimStart();
  if (trimmed.length > 0 && CSV_FORMULA_PREFIXES.includes(trimmed[0])) {
    return "'" + value;
  }
  return value;
}

// --- Extracted text sanitization ---

export function sanitizeExtractedText(text: string): string {
  let result = text;

  // Strip HTML tags
  result = result.replace(/<[^>]*>/g, "");

  // Remove null bytes
  result = result.replace(/\x00/g, "");

  // Remove control characters except \n, \t, \r
  result = result.replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  return result;
}

// --- Combined validation pipeline ---

export async function validateFile(
  buffer: Buffer,
  filename: string,
): Promise<FileValidationResult> {
  // 1. Determine file type from extension
  const fileType = getFileTypeFromName(filename);
  if (!fileType) {
    return {
      valid: false,
      error: "Unsupported file type. Accepted: PDF, CSV, DOCX, PNG, JPG, WEBP",
    };
  }

  // 2. Check file size
  if (!validateFileSize(buffer.length, fileType)) {
    if (buffer.length === 0) {
      return { valid: false, error: "File is empty" };
    }
    const limitLabel = fileType === "image" ? "3.75 MB" : "10 MB";
    return {
      valid: false,
      error: `File exceeds maximum size of ${limitLabel}`,
    };
  }

  // 3. Validate magic bytes
  if (!validateMagicBytes(buffer, fileType)) {
    // Check if it's a dangerous file type
    for (const sig of DANGEROUS_SIGNATURES) {
      if (matchesBytes(buffer, sig)) {
        return {
          valid: false,
          error: "Potentially dangerous file detected",
        };
      }
    }
    return {
      valid: false,
      error: "File content does not match declared type",
    };
  }

  // 4. Content-specific safety scans
  if (fileType === "docx") {
    const docxScan = await scanDocxForThreats(buffer);
    if (!docxScan.safe) {
      return {
        valid: false,
        error: docxScan.reason ?? "DOCX validation failed",
      };
    }
  }

  if (fileType === "pdf") {
    const pdfScan = scanPdfForThreats(buffer);
    if (!pdfScan.safe) {
      return { valid: false, error: pdfScan.reason ?? "PDF validation failed" };
    }
  }

  return { valid: true, fileType };
}
