/**
 * Microsoft Information Protection (MIP) Sensitivity Label Configuration
 *
 * These settings embed Microsoft Purview sensitivity labels into exported files
 * so they are recognized by Office apps and MIP-aware services.
 *
 * To obtain your organization's label GUID:
 *   1. Go to Microsoft Purview compliance portal → Information protection → Labels
 *   2. Click the "Confidential" label → Copy the Label ID (GUID)
 *
 * Configured at runtime via MIP_LABEL_ID, MIP_TENANT_ID and MIP_LABEL_NAME
 * (see lib/config/app-config.ts).
 */

export interface MipLabelConfig {
  labelId: string;
  siteId: string;
  labelName: string;
  enabled: boolean;
}

/**
 * Generate a random GUID for MIP ActionId fields using a cryptographically
 * secure source of randomness.
 */
function generateGuid(): string {
  // Prefer built-in UUID support when available (Node 15+ / modern browsers)
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  // Fallback: construct a UUIDv4 using crypto.getRandomValues for secure entropy
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    // Per RFC 4122 §4.4: set version (4) and variant bits
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const byteToHex: string[] = [];
    for (let i = 0; i < 256; i++) {
      byteToHex.push((i + 0x100).toString(16).slice(1));
    }

    return (
      byteToHex[bytes[0]] +
      byteToHex[bytes[1]] +
      byteToHex[bytes[2]] +
      byteToHex[bytes[3]] +
      "-" +
      byteToHex[bytes[4]] +
      byteToHex[bytes[5]] +
      "-" +
      byteToHex[bytes[6]] +
      byteToHex[bytes[7]] +
      "-" +
      byteToHex[bytes[8]] +
      byteToHex[bytes[9]] +
      "-" +
      byteToHex[bytes[10]] +
      byteToHex[bytes[11]] +
      byteToHex[bytes[12]] +
      byteToHex[bytes[13]] +
      byteToHex[bytes[14]] +
      byteToHex[bytes[15]]
    );
  }

  // Fail closed rather than silently falling back to insecure randomness
  throw new Error(
    "Secure GUID generation is not available in this environment.",
  );
}

/**
 * Build the set of custom document properties that encode a MIP sensitivity
 * label in an Office Open XML file (Excel, Word, PowerPoint).
 *
 * These properties are written to docProps/custom.xml and are read by
 * Microsoft 365 apps, the MIP unified labeling client, and DLP policies.
 *
 * @see https://learn.microsoft.com/en-us/information-protection/develop/concept-mip-metadata
 */
export function buildMipCustomProperties(
  config: MipLabelConfig,
): Record<string, string> {
  if (!config.enabled) return {};

  const prefix = `MSIP_Label_${config.labelId}`;
  const now = new Date().toISOString();
  const actionId = generateGuid();

  return {
    [`${prefix}_Enabled`]: "true",
    [`${prefix}_SetDate`]: now,
    [`${prefix}_Method`]: "Privileged",
    [`${prefix}_Name`]: config.labelName,
    [`${prefix}_SiteId`]: config.siteId,
    [`${prefix}_ActionId`]: actionId,
    [`${prefix}_ContentBits`]: "0",
  };
}
