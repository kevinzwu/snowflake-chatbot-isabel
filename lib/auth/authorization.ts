import { Session } from "next-auth";

/**
 * Configuration for group-based authorization
 * Azure AD Group IDs that are allowed to access Snowflake resources
 */

// Environment variables for allowed Azure AD group IDs
// These should be comma-separated GUIDs in the environment variable
const ALLOWED_GROUPS_ENV = process.env.ALLOWED_AZURE_AD_GROUPS || "";
const ADMIN_GROUPS_ENV = process.env.ADMIN_AZURE_AD_GROUPS || "";

/**
 * Parse comma-separated group IDs from environment variable
 */
function parseGroupIds(envValue: string): string[] {
  if (!envValue.trim()) return [];
  return envValue
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id.length > 0);
}

/**
 * Get allowed group IDs for general access
 */
export function getAllowedGroups(): string[] {
  return parseGroupIds(ALLOWED_GROUPS_ENV);
}

/**
 * Get admin group IDs for elevated access
 */
export function getAdminGroups(): string[] {
  return parseGroupIds(ADMIN_GROUPS_ENV);
}

/**
 * Extended session interface with group information
 */
export interface SessionWithGroups extends Session {
  user: Session["user"] & {
    groups?: string[];
    isAdmin?: boolean;
  };
  groups?: string[];
}

/**
 * Check if a user belongs to any of the allowed groups
 */
export function isUserInAllowedGroups(
  userGroups: string[] | undefined,
): boolean {
  if (!userGroups || userGroups.length === 0) {
    console.warn("Authorization check: User has no groups assigned");
    return false;
  }

  const allowedGroups = getAllowedGroups();
  const adminGroups = getAdminGroups();

  // If no groups are configured, deny access for security
  if (allowedGroups.length === 0 && adminGroups.length === 0) {
    console.warn(
      "Authorization check: No allowed groups configured. Set ALLOWED_AZURE_AD_GROUPS or ADMIN_AZURE_AD_GROUPS environment variable.",
    );
    return false;
  }

  const allAllowedGroups = [...allowedGroups, ...adminGroups];
  const userGroupsLower = userGroups.map((g) => g.toLowerCase());

  const hasAccess = userGroupsLower.some((userGroup) =>
    allAllowedGroups.includes(userGroup),
  );

  if (!hasAccess) {
    console.warn(
      `Authorization check: User groups [${userGroups.join(", ")}] not in allowed groups`,
    );
  }

  return hasAccess;
}

/**
 * Check if a user is an admin
 */
export function isUserAdmin(userGroups: string[] | undefined): boolean {
  if (!userGroups || userGroups.length === 0) {
    return false;
  }

  const adminGroups = getAdminGroups();
  if (adminGroups.length === 0) {
    return false;
  }

  const userGroupsLower = userGroups.map((g) => g.toLowerCase());
  return userGroupsLower.some((userGroup) => adminGroups.includes(userGroup));
}

/**
 * Authorization result with detailed information
 */
export interface AuthorizationResult {
  authorized: boolean;
  isAdmin: boolean;
  reason?: string;
  userGroups?: string[];
}

/**
 * Perform full authorization check on a session
 */
export function authorizeSession(
  session: SessionWithGroups | null,
): AuthorizationResult {
  if (!session) {
    return {
      authorized: false,
      isAdmin: false,
      reason: "No session found",
    };
  }

  if (!session.user) {
    return {
      authorized: false,
      isAdmin: false,
      reason: "No user in session",
    };
  }

  const userGroups = session.groups || session.user.groups;

  if (!isUserInAllowedGroups(userGroups)) {
    return {
      authorized: false,
      isAdmin: false,
      reason: "User is not a member of any authorized group",
      userGroups,
    };
  }

  return {
    authorized: true,
    isAdmin: isUserAdmin(userGroups),
    userGroups,
  };
}

/**
 * Log authorization attempt for audit trail
 */
export function logAuthorizationAttempt(
  userEmail: string | null | undefined,
  resource: string,
  result: AuthorizationResult,
): void {
  const timestamp = new Date().toISOString();
  const status = result.authorized ? "GRANTED" : "DENIED";

  console.log(
    JSON.stringify({
      timestamp,
      event: "authorization_attempt",
      user: userEmail || "unknown",
      resource,
      status,
      isAdmin: result.isAdmin,
      reason: result.reason,
      groups: result.userGroups?.length || 0,
    }),
  );
}
