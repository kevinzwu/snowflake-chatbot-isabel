/**
 * OAuth Service Account Validation
 *
 * Validates OAuth tokens from Azure AD for service accounts
 * using the Client Credentials flow.
 *
 * Security:
 * - Validates JWT signature against Azure AD public keys (JWKS)
 * - Verifies audience matches Isabel's app registration
 * - Verifies issuer is the expected Azure AD tenant
 * - Checks client ID is in allowed service accounts list
 * - Validates service account configuration schema with Zod
 * - Caches JWKS keys to avoid repeated calls
 */

import { createRemoteJWKSet, JWTPayload, jwtVerify } from "jose";
import { z } from "zod";

// Azure AD configuration. No fallbacks: validation fails closed when unset.
const TENANT_ID = process.env.AZURE_AD_TENANT_ID || "";
const ISABEL_APP_ID = process.env.AZURE_AD_CLIENT_ID || "";

// JWKS endpoint for Azure AD token signature verification
const AZURE_AD_JWKS_URL = `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`;

// Expected issuer for tokens
const EXPECTED_ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;

// Create JWKS key set (automatically caches and refreshes keys)
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(AZURE_AD_JWKS_URL));
  }
  return jwks;
}

/**
 * Service account configuration schema
 * Validates Azure AD application (client) IDs to service account metadata
 */
const ServiceAccountConfigSchema = z.object({
  clientId: z.string().min(1, "clientId is required"),
  name: z.string().min(1, "name is required"),
  scopes: z.array(z.string()).min(1, "at least one scope is required"),
  enabled: z.boolean(),
});

/**
 * Schema for the entire service accounts configuration array
 */
const ServiceAccountsArraySchema = z.array(ServiceAccountConfigSchema);

/**
 * Service account configuration type (inferred from Zod schema)
 */
export type ServiceAccountConfig = z.infer<typeof ServiceAccountConfigSchema>;

/**
 * Load allowed service accounts from environment with schema validation
 * Format: JSON array of ServiceAccountConfig
 *
 * Example:
 * [
 *   {
 *     "clientId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
 *     "name": "Remediation Team Automation",
 *     "scopes": ["snowflake:write"],
 *     "enabled": true
 *   }
 * ]
 *
 * @returns Validated array of service account configurations
 */
function loadServiceAccounts(): ServiceAccountConfig[] {
  const configJson = process.env.OAUTH_SERVICE_ACCOUNTS;

  if (!configJson) {
    console.log(
      "OAUTH_SERVICE_ACCOUNTS not configured - OAuth service auth disabled",
    );
    return [];
  }

  try {
    const parsed = JSON.parse(configJson);

    // Validate the parsed JSON against our schema
    const result = ServiceAccountsArraySchema.safeParse(parsed);

    if (!result.success) {
      // Log detailed validation errors for debugging
      const errors = result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      console.error("OAUTH_SERVICE_ACCOUNTS validation failed:", errors);
      return [];
    }

    console.log(`Loaded ${result.data.length} OAuth service account(s)`);
    return result.data;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(
        "OAUTH_SERVICE_ACCOUNTS contains invalid JSON:",
        error.message,
      );
    } else {
      console.error("Failed to parse OAUTH_SERVICE_ACCOUNTS:", error);
    }
    return [];
  }
}

// Cache loaded accounts
let cachedAccounts: ServiceAccountConfig[] | null = null;

function getServiceAccounts(): ServiceAccountConfig[] {
  if (cachedAccounts === null) {
    cachedAccounts = loadServiceAccounts();
  }
  return cachedAccounts;
}

/**
 * Validated token result
 */
export interface OAuthValidationResult {
  valid: boolean;
  account?: ServiceAccountConfig;
  claims?: JWTPayload & {
    azp?: string; // Authorized party (client ID that requested token)
    oid?: string; // Object ID of the service principal
    app_displayname?: string; // App registration display name
  };
  reason?: string;
}

/**
 * Validate an OAuth Bearer token from Azure AD
 *
 * This validates tokens obtained via the Client Credentials flow:
 * - Service account authenticates to Azure AD with client_id + client_secret
 * - Gets an access token with Isabel as the audience
 * - Presents that token to this endpoint
 */
export async function validateOAuthToken(
  bearerToken: string,
): Promise<OAuthValidationResult> {
  if (!bearerToken) {
    return { valid: false, reason: "missing_token" };
  }

  if (!TENANT_ID || !ISABEL_APP_ID) {
    console.error("Azure AD configuration missing");
    return { valid: false, reason: "server_config_error" };
  }

  try {
    // Verify JWT signature, expiration, and claims
    // Accept both audience formats: "api://<app-id>" and just "<app-id>"
    const { payload } = await jwtVerify(bearerToken, getJWKS(), {
      issuer: EXPECTED_ISSUER,
      audience: [ISABEL_APP_ID, `api://${ISABEL_APP_ID}`], // Accept both formats
    });

    // Extract the client ID (azp = authorized party, or sub for client credentials)
    // In client credentials flow, 'sub' is the service principal object ID
    // 'azp' (if present) or we need to check 'appid' claim
    const clientId =
      (payload.azp as string) ||
      (payload.appid as string) ||
      (payload.sub as string);

    if (!clientId) {
      return { valid: false, reason: "missing_client_id" };
    }

    // Check if this client is in our allowed list
    const accounts = getServiceAccounts();
    const account = accounts.find((a) => a.clientId === clientId && a.enabled);

    if (!account) {
      console.warn(`OAuth token from unknown/disabled client: ${clientId}`);
      return { valid: false, reason: "unauthorized_client" };
    }

    return {
      valid: true,
      account,
      claims: payload as OAuthValidationResult["claims"],
    };
  } catch (error) {
    // Log the error type for debugging but don't expose details
    if (error instanceof Error) {
      if (error.message.includes("expired")) {
        return { valid: false, reason: "token_expired" };
      }
      if (
        error.message.includes("signature") ||
        error.message.includes("JWS")
      ) {
        return { valid: false, reason: "invalid_signature" };
      }
      if (error.message.includes("audience")) {
        return { valid: false, reason: "invalid_audience" };
      }
      if (error.message.includes("issuer")) {
        return { valid: false, reason: "invalid_issuer" };
      }
      console.error("OAuth token validation error:", error.message);
    }
    return { valid: false, reason: "validation_failed" };
  }
}

/**
 * Force reload of service accounts config
 */
export function reloadServiceAccounts(): void {
  cachedAccounts = null;
  getServiceAccounts();
}
