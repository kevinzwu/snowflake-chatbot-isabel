import { withAuth } from "next-auth/middleware";
import { isMockSnowflakeEnabled } from "./lib/demo";
import { NextResponse } from "next/server";

// Environment variables for allowed Azure AD group IDs
const ALLOWED_GROUPS = (process.env.ALLOWED_AZURE_AD_GROUPS || "")
  .split(",")
  .map((id) => id.trim().toLowerCase())
  .filter((id) => id.length > 0);

const ADMIN_GROUPS = (process.env.ADMIN_AZURE_AD_GROUPS || "")
  .split(",")
  .map((id) => id.trim().toLowerCase())
  .filter((id) => id.length > 0);

// Routes that require group-based authorization (not just authentication)
const PROTECTED_API_ROUTES = ["/api/jwt"];

/**
 * API v1 routes that implement their own authentication
 *
 * These routes are under /api/v1/ but handle authentication internally
 * (e.g., OAuth Client Credentials flow) rather than using NextAuth sessions.
 *
 * IMPORTANT: When adding new /api/v1/* endpoints:
 * - If the endpoint uses NextAuth session auth: Add to PROTECTED_API_ROUTES
 * - If the endpoint implements its own auth: Add to SELF_AUTHENTICATED_ROUTES
 *
 * Routes not in either list will require NextAuth authentication but not group authorization.
 */
const SELF_AUTHENTICATED_ROUTES = [
  "/api/v1/service-token", // OAuth Client Credentials - validates Azure AD tokens internally
];

/**
 * Check if user belongs to any allowed group
 */
function isUserAuthorized(groups: string[] | undefined): boolean {
  if (!groups || groups.length === 0) {
    console.warn("Authorization check: User has no groups in token");
    return false;
  }

  const allAllowedGroups = [...ALLOWED_GROUPS, ...ADMIN_GROUPS];

  // If no groups are configured, deny access for security
  if (allAllowedGroups.length === 0) {
    console.warn(
      "Middleware: No allowed groups configured. Set ALLOWED_AZURE_AD_GROUPS or ADMIN_AZURE_AD_GROUPS.",
    );
    return false;
  }

  const userGroupsLower = groups.map((g) => g.toLowerCase());
  return userGroupsLower.some((g) => allAllowedGroups.includes(g));
}

/**
 * Check if a path requires group authorization
 */
function requiresGroupAuthorization(pathname: string): boolean {
  return PROTECTED_API_ROUTES.some((route) => pathname.startsWith(route));
}

/**
 * Check if a route handles its own authentication (bypasses NextAuth)
 */
function isSelfAuthenticatedRoute(pathname: string): boolean {
  // Demo mode only: the server-side agent and feedback calls to the mock
  // carry no session cookie. The route itself 404s unless demo mode is on.
  if (isMockSnowflakeEnabled() && pathname.startsWith("/api/mock-snowflake")) {
    return true;
  }
  return SELF_AUTHENTICATED_ROUTES.some((route) => pathname.startsWith(route));
}

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    // Log access attempts for security audit
    if (token) {
      console.log(
        JSON.stringify({
          event: "auth_access",
          userEmail: token.email,
          path: pathname,
          timestamp: new Date().toISOString(),
        }),
      );
    }

    // Self-authenticated routes handle their own auth (e.g., OAuth Client Credentials).
    // Let them through without requiring a NextAuth session token.
    if (isSelfAuthenticatedRoute(pathname)) {
      return NextResponse.next();
    }

    // API routes must return JSON 401 instead of redirecting to the sign-in page.
    // The authorized callback lets API routes through so we can handle them here
    // rather than having withAuth redirect to HTML sign-in (which breaks API clients).
    if (pathname.startsWith("/api/") && !token) {
      console.warn(
        JSON.stringify({
          event: "auth_denied",
          path: pathname,
          reason: "unauthenticated",
          timestamp: new Date().toISOString(),
        }),
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check group-based authorization for protected API routes
    if (requiresGroupAuthorization(pathname)) {
      const userGroups = token?.groups as string[] | undefined;

      if (!isUserAuthorized(userGroups)) {
        console.warn(
          JSON.stringify({
            event: "auth_denied",
            userEmail: token?.email,
            path: pathname,
            reason: "insufficient_groups",
            timestamp: new Date().toISOString(),
          }),
        );

        return NextResponse.json(
          {
            error: "Forbidden",
            message:
              "You do not have permission to access this resource. Please contact your administrator to request access.",
          },
          { status: 403 },
        );
      }

      console.log(
        JSON.stringify({
          event: "auth_granted",
          userEmail: token?.email,
          path: pathname,
          timestamp: new Date().toISOString(),
        }),
      );
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const pathname = req.nextUrl.pathname;

        // Public routes that don't require any authentication
        const publicPaths = [
          "/auth/signin",
          "/auth/signout",
          "/auth/error",
          "/api/health", // Health check endpoint for load balancers
        ];
        const isPublicPath = publicPaths.some((path) =>
          pathname.startsWith(path),
        );

        if (isPublicPath) {
          return true;
        }

        // Self-authenticated routes handle their own auth (e.g., OAuth Client Credentials)
        // Allow these through the middleware - they validate tokens internally
        if (isSelfAuthenticatedRoute(pathname)) {
          return true;
        }

        // API routes: always allow through so the middleware function can return
        // a proper JSON 401 response. Without this, withAuth redirects to the
        // HTML sign-in page, breaking API clients that expect JSON responses.
        if (pathname.startsWith("/api/")) {
          return true;
        }

        // Require NextAuth session authentication for all other routes (pages)
        return !!token;
      },
    },
  },
);

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (NextAuth routes)
     * - api/health (Health check endpoint)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     *
     * Note: Self-authenticated routes (e.g., /api/v1/service-token) are handled
     * in the authorized callback via SELF_AUTHENTICATED_ROUTES, not excluded here.
     * This ensures all /api/v1/* routes go through the middleware for consistent
     * security logging and future-proofing.
     */
    "/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)",
  ],
};
