import { NextAuthOptions, Session } from "next-auth";
import { JWT } from "next-auth/jwt";
import AzureADProvider from "next-auth/providers/azure-ad";
import CredentialsProvider from "next-auth/providers/credentials";
import { DEV_USER_GROUP, isDevAuthEnabled } from "./demo";
import { sessionRevocationManager } from "./security/session-revocation";

// Extend the built-in session types
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      groups?: string[];
      isAdmin?: boolean;
    };
    sessionId: string;
    provider: string;
    loginTime: number;
    groups?: string[];
    isAdmin?: boolean;
  }

  interface User {
    id: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    sessionId: string;
    provider: string;
    loginTime: number;
    groups?: string[];
    isAdmin?: boolean;
  }
}

const azureProvider = () =>
  AzureADProvider({
    clientId: process.env.AZURE_AD_CLIENT_ID!,
    clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
    tenantId: process.env.AZURE_AD_TENANT_ID!,
    authorization: {
      params: {
        // Request group membership claims from Azure AD
        scope: "openid profile email",
      },
    },
    // Enable ID token for group claims (groups are often in ID token)
    idToken: true,
  });

// Demo mode only (DEV_AUTH=true outside production): one local user, no Azure AD.
const devLoginProvider = () =>
  CredentialsProvider({
    id: "dev-login",
    name: "Dev Login",
    credentials: {},
    async authorize() {
      return { id: "dev-user", name: "Dev User", email: "dev@example.com" };
    },
  });

export const authConfig: NextAuthOptions = {
  providers: [isDevAuthEnabled() ? devLoginProvider() : azureProvider()],

  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours
    updateAge: 60 * 60, // 1 hour
  },

  jwt: {
    maxAge: 8 * 60 * 60, // 8 hours
  },

  pages: {
    signIn: "/auth/signin",
    signOut: "/auth/signout",
    error: "/auth/error",
  },

  callbacks: {
    async jwt({ token, user, account, profile }): Promise<JWT> {
      // First time JWT callback is run, user object is available
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;
        token.provider = account?.provider || "unknown";

        // Add custom claims for audit trail
        token.sessionId = crypto.randomUUID();
        token.loginTime = Date.now();

        // Extract Azure AD groups from the profile or account
        // Groups can come from different places depending on Azure AD configuration:
        // 1. profile.groups - direct group claim
        // 2. account.id_token - decoded ID token with groups
        // 3. profile.roles - app roles assigned to user
        const azureProfile = profile as
          { groups?: string[]; roles?: string[] } | undefined;

        // Collect groups from all possible sources
        const groups: string[] = [];

        if (azureProfile?.groups && Array.isArray(azureProfile.groups)) {
          groups.push(...azureProfile.groups);
        }

        if (azureProfile?.roles && Array.isArray(azureProfile.roles)) {
          groups.push(...azureProfile.roles);
        }

        if (account?.provider === "dev-login" && isDevAuthEnabled()) {
          groups.push(DEV_USER_GROUP);
        }

        token.groups = Array.from(new Set(groups)); // Remove duplicates

        // Determine admin status based on admin groups
        const adminGroups = (process.env.ADMIN_AZURE_AD_GROUPS || "")
          .split(",")
          .map((g) => g.trim().toLowerCase())
          .filter((g) => g.length > 0);

        token.isAdmin =
          adminGroups.length > 0 &&
          token.groups.some((g) => adminGroups.includes(g.toLowerCase()));

        console.log(
          `User ${token.email} authenticated with ${token.groups.length} groups, isAdmin: ${token.isAdmin}`,
        );
      }

      return token;
    },

    async session({ session, token }): Promise<Session> {
      if (token && session.user) {
        session.user.id = token.id;
        session.user.email = token.email;
        session.user.name = token.name;
        session.user.image = token.picture as string;
        session.user.groups = token.groups;
        session.user.isAdmin = token.isAdmin;

        // Add session metadata for security and audit
        session.sessionId = token.sessionId;
        session.provider = token.provider;
        session.loginTime = token.loginTime;
        session.groups = token.groups;
        session.isAdmin = token.isAdmin;
      }

      return session;
    },

    async redirect({ url, baseUrl }) {
      // Allows relative callback URLs
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      // Allows callback URLs on the same origin
      else if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
  },

  events: {
    async signIn({ user, account }) {
      // Log successful sign-ins for security audit
      console.log(`User signed in: ${user.email} via ${account?.provider}`);
    },

    async signOut({ token }) {
      // Revoke the session to prevent JWT reuse after logout
      if (token?.sessionId) {
        sessionRevocationManager.revoke(
          token.sessionId as string,
          (token.email as string) || "unknown",
        );
      }
      console.log(`User signed out: ${token?.email}, session revoked`);
    },
  },

  // Enable debug in development
  debug: process.env.NODE_ENV === "development",
};
