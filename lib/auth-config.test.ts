import { afterEach, describe, expect, it, vi } from "vitest";

// NextAuth merges a provider's options over its defaults, so the effective id
// of a credentials provider is options.id.
function providerIds(config: { providers: unknown[] }): string[] {
  return config.providers.map((p) => {
    const provider = p as { id: string; options?: { id?: string } };
    return provider.options?.id ?? provider.id;
  });
}

async function loadAuthConfig() {
  vi.resetModules();
  const { authConfig } = await import("./auth-config");
  return authConfig;
}

describe("authConfig providers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("should use Azure AD by default", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH", "");

    const config = await loadAuthConfig();

    expect(providerIds(config)).toEqual(["azure-ad"]);
  });

  it("should use only the dev-login provider when DEV_AUTH is true outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH", "true");

    const config = await loadAuthConfig();

    expect(providerIds(config)).toEqual(["dev-login"]);
  });

  it("should ignore DEV_AUTH in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_AUTH", "true");

    const config = await loadAuthConfig();

    expect(providerIds(config)).toEqual(["azure-ad"]);
  });

  it("should put dev-login users in the local-dev group", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH", "true");
    const config = await loadAuthConfig();

    const token = await config.callbacks!.jwt!({
      token: {} as never,
      user: { id: "dev-user", email: "dev@example.com", name: "Dev User" },
      account: { provider: "dev-login" } as never,
    } as never);

    expect(token.groups).toEqual(["local-dev"]);
  });
});
