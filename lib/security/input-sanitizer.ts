/**
 * Input Sanitizer
 *
 * Provides industry-standard input validation and sanitization using DOMPurify.
 *
 * Security features:
 * - XSS prevention via DOMPurify (battle-tested, OWASP recommended)
 * - Input encoding normalization to prevent bypass attacks
 * - Defense-in-depth with multiple sanitization layers
 * - Dangerous URI scheme blocking (javascript:, vbscript:, data:)
 *
 * @module lib/security/input-sanitizer
 * @see https://github.com/cure53/DOMPurify
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
 */

import DOMPurify from "isomorphic-dompurify";

/** Maximum allowed input length (characters) */
export const MAX_INPUT_LENGTH = 10000;

/** Minimum valid input length after trimming */
export const MIN_INPUT_LENGTH = 1;

/**
 * Validation result returned by validateChatInput
 */
export interface InputValidationResult {
  /** Whether the input passed validation */
  isValid: boolean;
  /** The sanitized input (only meaningful if isValid is true) */
  sanitizedInput: string;
  /** Error message if validation failed */
  error?: string;
  /** Whether dangerous content was detected (for logging) */
  hadDangerousContent?: boolean;
}

/**
 * DOMPurify configuration for text-only output (strips all HTML)
 * This is the most restrictive mode - allows only plain text
 */
const DOMPURIFY_TEXT_CONFIG = {
  ALLOWED_TAGS: [] as string[], // No HTML tags allowed
  ALLOWED_ATTR: [] as string[], // No attributes allowed
  KEEP_CONTENT: true, // Keep text content from stripped tags
  RETURN_DOM: false as const,
  RETURN_DOM_FRAGMENT: false as const,
};

/**
 * HTML entities that need to be decoded for proper sanitization
 * Attackers use these to bypass regex-based filters
 */
const HTML_ENTITY_MAP: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&#x27;": "'",
  "&#x2F;": "/",
  "&#47;": "/",
  "&#60;": "<",
  "&#62;": ">",
  "&#34;": '"',
};

/**
 * Patterns for detecting dangerous content (used for logging/detection)
 * These are checked AFTER normalization to catch encoded attacks
 */
const DETECTION_PATTERNS = {
  /** Script tags including obfuscated variants */
  scriptTag: /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
  /** Event handlers */
  eventHandler: /\bon[a-z]+\s*=/gi,
  /** Dangerous URI schemes */
  dangerousUri: /(?:javascript|vbscript|data)\s*:/gi,
  /** Markdown links with dangerous schemes */
  markdownDangerousLink:
    /\[[^\]]*\]\(\s*(?:javascript|vbscript|data)\s*:[^)]*\)/gi,
  /** SVG elements (common XSS vector) */
  svgElement: /<svg[\s\S]*?>/gi,
  /** CSS expressions (legacy IE attack vector) */
  cssExpression: /expression\s*\(|behavior\s*:|binding\s*:/gi,
  /** Base64 data URIs (potential encoded payloads) */
  base64DataUri: /data:\s*[^;]*;\s*base64\s*,\s*[A-Za-z0-9+/=]{50,}/gi,
};

/**
 * Pattern for matching markdown links with dangerous schemes
 * Handles nested parentheses (e.g., javascript:alert(1))
 * Uses (?:[^()]*|\([^)]*\))* to match balanced parens up to 1 level deep
 */
const MARKDOWN_DANGEROUS_LINK =
  /\[([^\]]*)\]\(\s*(?:javascript|vbscript|data)\s*:(?:[^()]*|\([^)]*\))*\)/gi;

/**
 * Pattern for matching markdown images with dangerous schemes
 * Handles nested parentheses like the link pattern above
 */
const MARKDOWN_DANGEROUS_IMAGE =
  /!\[([^\]]*)\]\(\s*(?:javascript|vbscript|data)\s*:(?:[^()]*|\([^)]*\))*\)/gi;

/**
 * Pattern for standalone dangerous URIs (not in markdown context)
 * Matches schemes followed by content up to whitespace or common delimiters
 */
const STANDALONE_DANGEROUS_URI =
  /\b(?:javascript|vbscript)\s*:(?:[^()\s"'<>]*|\([^)]*\))*/gi;

/**
 * Normalizes input by decoding common encoding schemes used to bypass filters.
 *
 * This is critical for security - attackers frequently use:
 * - URL encoding: %3Cscript%3E -> <script>
 * - Double URL encoding: %253C -> %3C -> <
 * - HTML entities: &lt;script&gt; -> <script>
 * - Unicode escapes: \u003c -> <
 * - Mixed encodings: %26lt; -> &lt; -> <
 *
 * @param input - The potentially encoded input string
 * @returns The normalized/decoded string
 */
export function normalizeEncodings(input: string): string {
  if (!input || typeof input !== "string") {
    return "";
  }

  let normalized = input;

  // Decode URL encoding (up to 3 iterations for double/triple encoding)
  for (let i = 0; i < 3; i++) {
    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded === normalized) break;
      normalized = decoded;
    } catch {
      // Invalid URL encoding, continue with current value
      break;
    }
  }

  // Decode HTML entities
  for (const [entity, char] of Object.entries(HTML_ENTITY_MAP)) {
    normalized = normalized.replace(new RegExp(entity, "gi"), char);
  }

  // Decode numeric HTML entities (&#60; &#x3C;)
  normalized = normalized.replace(/&#(\d+);/g, (_, dec) =>
    String.fromCharCode(parseInt(dec, 10)),
  );
  normalized = normalized.replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );

  // Decode JavaScript Unicode escapes (\u003c)
  normalized = normalized.replace(/\\u([0-9a-f]{4})/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );

  return normalized;
}

/**
 * Strips markdown formatting syntax to convert to plain text.
 *
 * Removes:
 * - Headers: # ## ### etc.
 * - Bold/italic: **text** *text* __text__ _text_
 * - Strikethrough: ~~text~~
 * - Links: [text](url) -> text
 * - Images: ![alt](url) -> alt
 * - Inline code: `code` -> code
 * - Code blocks: ```code``` -> code
 * - Blockquotes: > text -> text
 * - Horizontal rules: --- *** ___
 * - List markers: - * + 1. 2.
 *
 * @param input - Text potentially containing markdown
 * @returns Plain text with formatting removed
 */
export function stripMarkdownFormatting(input: string): string {
  if (!input || typeof input !== "string") {
    return "";
  }

  let text = input;

  // Remove code blocks first (``` ... ```)
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    // Extract content between backticks
    return match.slice(3, -3).trim();
  });

  // Remove inline code (`code`)
  text = text.replace(/`([^`]+)`/g, "$1");

  // Remove images ![alt](url) -> keep alt text
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Remove links [text](url) -> keep text
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Remove reference-style links [text][ref] -> keep text
  text = text.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");

  // Remove bold/italic (process ** and __ before * and _)
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, "$1"); // ***bold italic***
  text = text.replace(/___([^_]+)___/g, "$1"); // ___bold italic___
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1"); // **bold**
  text = text.replace(/__([^_]+)__/g, "$1"); // __bold__
  text = text.replace(/\*([^*]+)\*/g, "$1"); // *italic*
  // _italic_ - only match when not part of snake_case (requires word boundary)
  text = text.replace(/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, "$1");

  // Remove strikethrough
  text = text.replace(/~~([^~]+)~~/g, "$1");

  // Remove headers (# ## ### etc.) at start of lines
  text = text.replace(/^#{1,6}\s+/gm, "");

  // Remove blockquotes (> ) at start of lines
  text = text.replace(/^>\s*/gm, "");

  // Remove horizontal rules (---, ***, ___)
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");

  // Remove unordered list markers (- * +) at start of lines
  text = text.replace(/^[\s]*[-*+]\s+/gm, "");

  // Remove ordered list markers (1. 2. etc.) at start of lines
  text = text.replace(/^[\s]*\d+\.\s+/gm, "");

  return text;
}

/**
 * Sanitizes user input using DOMPurify and additional security layers.
 *
 * Industry best practice approach:
 * 1. Normalize encoded input to catch bypass attempts
 * 2. Apply DOMPurify for robust HTML/XSS sanitization
 * 3. Remove dangerous URI schemes in markdown
 * 4. Normalize whitespace
 *
 * @param input - The raw user input string
 * @returns The sanitized string with dangerous content removed
 *
 * @example
 * ```ts
 * sanitizeInput('<script>alert("xss")</script>Hello')
 * // Returns: 'Hello'
 *
 * sanitizeInput('[click me](javascript:alert(1))')
 * // Returns: '[click me]()'
 *
 * sanitizeInput('%3Cscript%3Ealert(1)%3C/script%3E')
 * // Returns: '' (decodes then sanitizes)
 * ```
 */
export function sanitizeInput(input: string): string {
  if (!input || typeof input !== "string") {
    return "";
  }

  // Step 1: Normalize encodings to catch bypass attempts
  let sanitized = normalizeEncodings(input);

  // Step 2: Apply DOMPurify for robust XSS sanitization
  // This handles all HTML/JS injection vectors including:
  // - Script tags, event handlers, dangerous attributes
  // - SVG-based attacks, MathML vectors
  // - CSS expression attacks
  // - DOM clobbering attempts
  sanitized = DOMPurify.sanitize(sanitized, DOMPURIFY_TEXT_CONFIG) as string;

  // Step 3: Sanitize markdown-specific dangerous patterns
  // DOMPurify doesn't understand markdown syntax, so we handle this separately
  // Process images first (more specific pattern with !)
  sanitized = sanitized.replace(MARKDOWN_DANGEROUS_IMAGE, "![$1]()");
  sanitized = sanitized.replace(MARKDOWN_DANGEROUS_LINK, "[$1]()");

  // Step 4: Remove any standalone dangerous URI schemes that might remain
  // These could appear in plain text context (not within HTML tags)
  sanitized = sanitized.replace(STANDALONE_DANGEROUS_URI, "");

  // Step 5: Remove event handler patterns that appear as plain text
  // DOMPurify strips these from HTML attributes, but they might appear as text
  sanitized = sanitized.replace(/\bon[a-z]+\s*=\s*["'][^"']*["']/gi, "");

  // Step 6: Strip markdown formatting to enforce plain text
  sanitized = stripMarkdownFormatting(sanitized);

  // Step 7: Normalize whitespace (collapse multiple spaces/newlines but preserve structure)
  sanitized = sanitized
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return sanitized;
}

/**
 * Validates user chat input for security and length constraints.
 *
 * This is the main entry point for input validation in the chat component.
 * It performs sanitization and validates the result against length constraints.
 *
 * Security flow:
 * 1. Type and null checks
 * 2. Length validation (pre-sanitization)
 * 3. Dangerous content detection (for logging)
 * 4. Sanitization via DOMPurify
 * 5. Length validation (post-sanitization)
 *
 * @param input - The raw user input string
 * @returns Validation result with sanitized input or error message
 *
 * @example
 * ```ts
 * const result = validateChatInput('What are the current vulnerabilities?');
 * if (result.isValid) {
 *   handleSubmit(result.sanitizedInput);
 * } else {
 *   showError(result.error);
 * }
 * ```
 */
export function validateChatInput(input: string): InputValidationResult {
  // Check for null/undefined
  if (input === null || input === undefined) {
    return {
      isValid: false,
      sanitizedInput: "",
      error: "Input is required",
    };
  }

  // Ensure input is a string
  if (typeof input !== "string") {
    return {
      isValid: false,
      sanitizedInput: "",
      error: "Input must be a string",
    };
  }

  // Check raw length before sanitization (with buffer for encoded content)
  if (input.length > MAX_INPUT_LENGTH * 2) {
    return {
      isValid: false,
      sanitizedInput: "",
      error: `Input exceeds maximum length of ${MAX_INPUT_LENGTH} characters`,
    };
  }

  // Detect dangerous content BEFORE sanitization (for logging/monitoring)
  const hadDangerousContent = containsDangerousContent(input);

  // Sanitize the input
  const sanitizedInput = sanitizeInput(input);

  // Check if input is empty after trimming
  if (sanitizedInput.length < MIN_INPUT_LENGTH) {
    return {
      isValid: false,
      sanitizedInput: "",
      error: "Please enter a message",
      hadDangerousContent,
    };
  }

  // Check length after sanitization
  if (sanitizedInput.length > MAX_INPUT_LENGTH) {
    return {
      isValid: false,
      sanitizedInput: "",
      error: `Input exceeds maximum length of ${MAX_INPUT_LENGTH} characters`,
      hadDangerousContent,
    };
  }

  return {
    isValid: true,
    sanitizedInput,
    hadDangerousContent,
  };
}

/**
 * Checks if input contains any potentially dangerous content.
 *
 * This function normalizes encodings FIRST before checking patterns,
 * catching encoded attack vectors that would bypass simple pattern matching.
 *
 * Use this for:
 * - Logging/security monitoring
 * - WAF-style detection without blocking
 * - Audit trails of attempted attacks
 *
 * @param input - The raw user input string
 * @returns True if potentially dangerous content was detected
 *
 * @example
 * ```ts
 * if (containsDangerousContent(userInput)) {
 *   logger.warn('Potential XSS attempt detected', { input: userInput });
 * }
 * ```
 */
export function containsDangerousContent(input: string): boolean {
  if (!input || typeof input !== "string") {
    return false;
  }

  // CRITICAL: Normalize encodings before checking patterns
  // This catches %3Cscript%3E, &#60;script&#62;, \u003cscript\u003e, etc.
  const normalized = normalizeEncodings(input);

  // Check all detection patterns against normalized input
  const patterns = Object.values(DETECTION_PATTERNS);

  return patterns.some((pattern) => {
    pattern.lastIndex = 0; // Reset for global patterns
    return pattern.test(normalized);
  });
}

/**
 * Sanitizes a string for safe use in API storage.
 *
 * This is a convenience wrapper that applies sanitization and returns
 * the result, suitable for use in API routes before storing user data.
 *
 * @param input - The raw user input string
 * @param fieldName - Optional field name for error messages
 * @returns Object with sanitized value and validation status
 */
export function sanitizeForStorage(
  input: unknown,
  fieldName = "value",
): { value: string; isValid: boolean; error?: string } {
  if (input === null || input === undefined) {
    return { value: "", isValid: true };
  }

  if (typeof input !== "string") {
    return {
      value: "",
      isValid: false,
      error: `${fieldName} must be a string`,
    };
  }

  const sanitized = sanitizeInput(input);
  return { value: sanitized, isValid: true };
}
