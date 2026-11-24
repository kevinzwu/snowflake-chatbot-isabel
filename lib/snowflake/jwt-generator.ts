/**
 * Snowflake JWT Generator
 *
 * Shared utility for generating Snowflake JWTs using RSA key-pair authentication.
 * Used by both interactive user sessions and service account authentication.
 *
 * Key handling supports:
 * - Environment variable (SNOWFLAKE_RSA_KEY) - preferred for production
 * - File-based keys (SNOWFLAKE_RSA_KEY_PATH, default .key/rsa_key.p8) - for local development
 * - Encrypted PKCS#8 keys with passphrase decryption (using native Node.js crypto)
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  KeyObject,
} from "crypto";
import fs from "fs";
import jwt from "jsonwebtoken";
import path from "path";

/**
 * Context information for user JWT generation (interactive sessions)
 */
export interface UserJWTContext {
  sessionId?: string;
  userId?: string;
  userEmail?: string | null;
  loginTime?: number;
  provider?: string;
  isAdmin?: boolean;
  groupCount?: number;
}

/**
 * Context information for service account JWT generation
 */
export interface ServiceAccountJWTContext {
  clientId: string;
  name: string;
  scopes: string[];
  oid?: string; // Azure AD object ID
  appName?: string;
}

/**
 * JWT generation result
 */
export interface JWTGenerationResult {
  token: string;
  expiresAt: number;
}

/**
 * Get RSA key from environment variable or file
 *
 * Priority: Environment variable > File
 * This avoids embedding keys in Docker image layers
 *
 * @returns Buffer containing the RSA private key in PEM format
 * @throws Error if RSA key is not found or cannot be read
 */
export function getRSAKey(): Buffer {
  // First, try to get from environment variable (injected via ECS secrets manager)
  const rsaKeyEnv = process.env.SNOWFLAKE_RSA_KEY;
  if (rsaKeyEnv) {
    // Check if it's a filename reference (legacy local dev setup)
    if (rsaKeyEnv.endsWith(".p8") || rsaKeyEnv.endsWith(".pem")) {
      const keyPath = path.join(process.cwd(), rsaKeyEnv);
      if (fs.existsSync(keyPath)) {
        return fs.readFileSync(keyPath);
      }
      throw new Error(`RSA key file not found: ${keyPath}`);
    }

    // Handle different formats:
    // 1. Plain PEM string (most common)
    // 2. Base64-encoded PEM
    // 3. JSON-escaped string with \n literals
    let keyContent = rsaKeyEnv;

    // If it doesn't start with a PEM header, assume base64-encoded
    if (!keyContent.startsWith("-----BEGIN")) {
      try {
        keyContent = Buffer.from(keyContent, "base64").toString("utf-8");
      } catch {
        // Not base64, use as-is
      }
    }

    // Replace literal \n with actual newlines (common in JSON strings)
    keyContent = keyContent.replace(/\\n/g, "\n");

    return Buffer.from(keyContent, "utf-8");
  }

  // Fallback: read from file (for local development)
  const keyPath = path.resolve(
    process.cwd(),
    process.env.SNOWFLAKE_RSA_KEY_PATH || ".key/rsa_key.p8",
  );
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath);
  }

  throw new Error(
    `RSA key not found. Set SNOWFLAKE_RSA_KEY, or provide a key file at ${keyPath} (override with SNOWFLAKE_RSA_KEY_PATH).`,
  );
}

/**
 * Load and parse the RSA private key for JWT signing
 *
 * Uses Node.js native crypto APIs to handle both encrypted and unencrypted keys.
 * This avoids shelling out to OpenSSL, eliminating command injection risks.
 *
 * Supported key formats:
 * - Unencrypted PKCS#8 (BEGIN PRIVATE KEY)
 * - Encrypted PKCS#8 (BEGIN ENCRYPTED PRIVATE KEY)
 * - Traditional RSA (BEGIN RSA PRIVATE KEY)
 *
 * @param passphrase - Optional passphrase for encrypted keys
 * @returns Object containing the private key and raw key string for signing
 * @throws Error if key cannot be loaded or parsed
 */
export function loadPrivateKey(passphrase?: string): {
  privateKey: KeyObject;
  rsaKeyString: string;
} {
  // Handle passphrase conventions:
  // - "NO_PASSPHRASE" = key has no passphrase (used in production/staging Secrets Manager)
  // - "EMPTY" = explicit empty passphrase sentinel
  // - " " or whitespace = AWS Secrets Manager workaround for empty
  const rawPassphrase = passphrase ?? process.env.SNOWFLAKE_RSA_PASSPHRASE;
  const effectivePassphrase =
    rawPassphrase === "NO_PASSPHRASE" ||
    rawPassphrase === "EMPTY" ||
    rawPassphrase?.trim() === ""
      ? ""
      : rawPassphrase;
  const rsaKey = getRSAKey();
  const keyStr = rsaKey.toString();

  let privateKey: KeyObject;

  try {
    // Check if the key is encrypted (PKCS#8 encrypted format)
    if (keyStr.includes("BEGIN ENCRYPTED PRIVATE KEY")) {
      if (effectivePassphrase === undefined) {
        throw new Error(
          "Key is encrypted but no passphrase provided. Set SNOWFLAKE_RSA_PASSPHRASE environment variable (use NO_PASSPHRASE for empty).",
        );
      }
      // Node.js crypto natively handles encrypted PKCS#8 keys (empty passphrase is valid)
      privateKey = createPrivateKey({
        key: rsaKey,
        format: "pem",
        passphrase: effectivePassphrase,
      });
    } else {
      // Unencrypted key (PKCS#8 or traditional RSA format)
      privateKey = createPrivateKey({
        key: rsaKey,
        format: "pem",
      });
    }
  } catch (error) {
    const err = error as Error;
    // Provide helpful error messages for common issues
    if (
      err.message.includes("bad decrypt") ||
      err.message.includes("wrong password")
    ) {
      throw new Error(
        "Failed to decrypt private key: incorrect passphrase. Verify SNOWFLAKE_RSA_PASSPHRASE is correct.",
      );
    }
    if (err.message.includes("unsupported")) {
      throw new Error(
        `Unsupported key format. Ensure the key is in PKCS#8 format. Original error: ${err.message}`,
      );
    }
    throw new Error(`Failed to load private key: ${err.message}`);
  }

  // Export the private key in PEM format for JWT signing
  const rsaKeyString = privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string;

  return { privateKey, rsaKeyString };
}

/**
 * Calculate the SHA256 fingerprint of an RSA public key
 *
 * Used by Snowflake to identify the key pair for authentication.
 *
 * @param privateKey - The RSA private key to derive the public key from
 * @returns SHA256 fingerprint in "SHA256:base64hash" format
 */
export function calculatePublicKeyFingerprint(privateKey: KeyObject): string {
  const publicKey = createPublicKey(privateKey);
  const publicKeyRaw = publicKey.export({ type: "spki", format: "der" });
  const sha256Hash = createHash("sha256").update(publicKeyRaw).digest("base64");
  return "SHA256:" + sha256Hash;
}

/**
 * Get Snowflake account configuration from environment
 *
 * @returns Object containing account and user names (uppercased as required by Snowflake)
 */
export function getSnowflakeConfig(): {
  account: string;
  user: string;
  qualifiedUsername: string;
} {
  const account = process.env.SNOWFLAKE_ACCOUNT?.toUpperCase() ?? "";
  const user = process.env.SNOWFLAKE_USER?.toUpperCase() ?? "";
  const qualifiedUsername = `${account}.${user}`;

  return { account, user, qualifiedUsername };
}

/**
 * Generate a Snowflake JWT for interactive user sessions
 *
 * Includes user context in the JWT payload for audit trail purposes.
 *
 * @param userContext - User session information for audit trail
 * @returns JWT token and expiration timestamp
 * @throws Error if JWT generation fails
 */
export function generateUserJWT(
  userContext: UserJWTContext,
): JWTGenerationResult {
  const { privateKey, rsaKeyString } = loadPrivateKey();
  const publicKeyFp = calculatePublicKeyFingerprint(privateKey);
  const { qualifiedUsername } = getSnowflakeConfig();

  const nowInSeconds = Math.floor(Date.now() / 1000);
  const oneHourInSeconds = 60 * 60;

  const payload = {
    iss: `${qualifiedUsername}.${publicKeyFp}`,
    sub: qualifiedUsername,
    iat: nowInSeconds,
    exp: nowInSeconds + oneHourInSeconds,
    // Include user context for audit trail while keeping shared Snowflake auth
    userContext,
  };

  const token = jwt.sign(payload, rsaKeyString, { algorithm: "RS256" });

  return {
    token,
    expiresAt: nowInSeconds + oneHourInSeconds - 120, // 2 minutes before actual expiration
  };
}

/**
 * Generate a Snowflake JWT for service account authentication
 *
 * Includes service account context in the JWT payload for audit trail.
 *
 * @param serviceContext - Service account information for audit trail
 * @returns JWT token and expiration timestamp
 * @throws Error if JWT generation fails
 */
export function generateServiceAccountJWT(
  serviceContext: ServiceAccountJWTContext,
): JWTGenerationResult {
  const { privateKey, rsaKeyString } = loadPrivateKey();
  const publicKeyFp = calculatePublicKeyFingerprint(privateKey);
  const { qualifiedUsername } = getSnowflakeConfig();

  const nowInSeconds = Math.floor(Date.now() / 1000);
  const oneHourInSeconds = 60 * 60;

  const payload = {
    iss: `${qualifiedUsername}.${publicKeyFp}`,
    sub: qualifiedUsername,
    iat: nowInSeconds,
    exp: nowInSeconds + oneHourInSeconds,
    // Service account context for audit trail
    svc: serviceContext,
  };

  const token = jwt.sign(payload, rsaKeyString, { algorithm: "RS256" });

  return {
    token,
    expiresAt: nowInSeconds + oneHourInSeconds - 120, // 2 min buffer
  };
}
