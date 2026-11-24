/**
 * Input Validators
 *
 * Provides validation utilities for API route parameters and request bodies.
 * These validators ensure inputs match expected formats before processing.
 *
 * @module lib/security/validators
 */

/**
 * UUID v4 regex pattern (RFC 4122 compliant)
 * Matches: 123e4567-e89b-12d3-a456-426614174000
 */
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Short UUID pattern (base58 encoded, 22 chars)
 * Used by short-uuid library
 * Matches: mhvXdrZT4jP5T8vBxuvm75
 */
const SHORT_UUID_PATTERN =
  /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{22}$/;

/**
 * Validates a standard UUID v4 format
 *
 * @param value - The string to validate
 * @returns True if valid UUID v4 format
 *
 * @example
 * ```ts
 * isValidUUID('123e4567-e89b-12d3-a456-426614174000') // true
 * isValidUUID('not-a-uuid') // false
 * isValidUUID('') // false
 * ```
 */
export function isValidUUID(value: unknown): value is string {
  if (typeof value !== "string" || !value) {
    return false;
  }
  return UUID_V4_PATTERN.test(value);
}

/**
 * Validates a short UUID format (22-character base58)
 * Used for conversation IDs and other short identifiers
 *
 * @param value - The string to validate
 * @returns True if valid short UUID format
 *
 * @example
 * ```ts
 * isValidShortUUID('mhvXdrZT4jP5T8vBxuvm75') // true
 * isValidShortUUID('invalid') // false
 * ```
 */
export function isValidShortUUID(value: unknown): value is string {
  if (typeof value !== "string" || !value) {
    return false;
  }
  return SHORT_UUID_PATTERN.test(value);
}

/**
 * Validates an ID that could be either standard UUID or short UUID
 *
 * @param value - The string to validate
 * @returns True if valid UUID or short UUID format
 */
export function isValidId(value: unknown): value is string {
  return isValidUUID(value) || isValidShortUUID(value);
}

/**
 * Validation result type
 */
export interface ValidationResult<T = string> {
  isValid: boolean;
  value: T;
  error?: string;
}

/**
 * Validates and sanitizes a route parameter ID
 *
 * @param paramValue - The raw parameter value from the route
 * @param paramName - The parameter name for error messages
 * @returns Validation result with the ID or error
 *
 * @example
 * ```ts
 * const result = validateRouteId(params.conversationId, 'conversationId');
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 });
 * }
 * const conversationId = result.value;
 * ```
 */
export function validateRouteId(
  paramValue: unknown,
  paramName: string,
): ValidationResult {
  if (!paramValue) {
    return {
      isValid: false,
      value: "",
      error: `${paramName} is required`,
    };
  }

  if (typeof paramValue !== "string") {
    return {
      isValid: false,
      value: "",
      error: `${paramName} must be a string`,
    };
  }

  // Trim and validate
  const trimmed = paramValue.trim();

  if (!isValidId(trimmed)) {
    return {
      isValid: false,
      value: "",
      error: `Invalid ${paramName} format`,
    };
  }

  return {
    isValid: true,
    value: trimmed,
  };
}

/**
 * Snowflake identifier regex pattern.
 * Valid identifiers: start with letter or underscore, contain only letters, digits,
 * underscores, and dollar signs. Max 256 characters.
 * Does NOT support quoted/delimited identifiers — only unquoted SQL identifiers.
 *
 * @see https://docs.snowflake.com/en/sql-reference/identifiers-syntax
 */
const SNOWFLAKE_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]{0,255}$/;

/**
 * Validates a Snowflake SQL identifier (unquoted).
 * Prevents SSRF by ensuring values used in URL path segments are safe Snowflake identifiers.
 *
 * @param value - The string to validate
 * @returns True if valid unquoted Snowflake identifier
 *
 * @example
 * ```ts
 * isValidSnowflakeIdentifier('ISABEL_SAMPLE') // true
 * isValidSnowflakeIdentifier('SECURITY')             // true
 * isValidSnowflakeIdentifier('../../evil')           // false
 * isValidSnowflakeIdentifier('')                     // false
 * ```
 */
export function isValidSnowflakeIdentifier(value: unknown): value is string {
  if (typeof value !== "string" || !value) {
    return false;
  }
  return SNOWFLAKE_IDENTIFIER_PATTERN.test(value);
}

/**
 * Validates an email address format
 *
 * @param value - The string to validate
 * @returns True if valid email format
 */
export function isValidEmail(value: unknown): value is string {
  if (typeof value !== "string" || !value) {
    return false;
  }
  // RFC 5322 simplified pattern
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(value) && value.length <= 254;
}

/**
 * Validates a non-empty string with optional length constraints
 *
 * @param value - The value to validate
 * @param options - Validation options
 * @returns Validation result
 */
export function validateString(
  value: unknown,
  options: {
    fieldName: string;
    minLength?: number;
    maxLength?: number;
    required?: boolean;
  },
): ValidationResult {
  const {
    fieldName,
    minLength = 0,
    maxLength = 10000,
    required = false,
  } = options;

  if (value === null || value === undefined || value === "") {
    if (required) {
      return { isValid: false, value: "", error: `${fieldName} is required` };
    }
    return { isValid: true, value: "" };
  }

  if (typeof value !== "string") {
    return {
      isValid: false,
      value: "",
      error: `${fieldName} must be a string`,
    };
  }

  const trimmed = value.trim();

  if (minLength > 0 && trimmed.length < minLength) {
    return {
      isValid: false,
      value: "",
      error: `${fieldName} must be at least ${minLength} characters`,
    };
  }

  if (trimmed.length > maxLength) {
    return {
      isValid: false,
      value: "",
      error: `${fieldName} must be at most ${maxLength} characters`,
    };
  }

  return { isValid: true, value: trimmed };
}

/**
 * Validates an array of strings
 *
 * @param value - The value to validate
 * @param options - Validation options
 * @returns Validation result with string array
 */
export function validateStringArray(
  value: unknown,
  options: {
    fieldName: string;
    maxItems?: number;
    maxItemLength?: number;
  },
): ValidationResult<string[]> {
  const { fieldName, maxItems = 100, maxItemLength = 1000 } = options;

  if (!Array.isArray(value)) {
    return {
      isValid: false,
      value: [],
      error: `${fieldName} must be an array`,
    };
  }

  if (value.length > maxItems) {
    return {
      isValid: false,
      value: [],
      error: `${fieldName} cannot have more than ${maxItems} items`,
    };
  }

  const sanitizedItems: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return {
        isValid: false,
        value: [],
        error: `${fieldName} items must be strings`,
      };
    }
    if (item.length > maxItemLength) {
      return {
        isValid: false,
        value: [],
        error: `${fieldName} items cannot exceed ${maxItemLength} characters`,
      };
    }
    sanitizedItems.push(item.trim());
  }

  return { isValid: true, value: sanitizedItems };
}
