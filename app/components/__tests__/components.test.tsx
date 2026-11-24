/**
 * Component tests for key React components
 *
 * Tests cover:
 * - AuthButton: renders based on session state
 * - ChatInput: rendering and user interaction (lightweight)
 */

import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

// ─── AuthButton Tests ────────────────────────────────────────────────

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock next/image
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) =>
    React.createElement("img", {
      ...props,
      src: props.src as string,
      alt: props.alt as string,
    }),
}));

import { AuthButton } from "@/app/components/auth-button";
import { signIn, signOut, useSession } from "next-auth/react";

const mockedUseSession = vi.mocked(useSession);

describe("AuthButton", () => {
  it("should show loading state", () => {
    mockedUseSession.mockReturnValue({
      data: null,
      status: "loading",
      update: vi.fn(),
    });

    const { container } = render(React.createElement(AuthButton));
    // Should show animated pulse placeholders
    const pulseElements = container.querySelectorAll(".animate-pulse");
    expect(pulseElements.length).toBeGreaterThan(0);
  });

  it("should show sign in button when not authenticated", () => {
    mockedUseSession.mockReturnValue({
      data: null,
      status: "unauthenticated",
      update: vi.fn(),
    });

    render(React.createElement(AuthButton));
    expect(screen.getByText("Sign In")).toBeDefined();
  });

  it("should show user info and sign out when authenticated", () => {
    mockedUseSession.mockReturnValue({
      data: {
        user: {
          id: "user-1",
          name: "Test User",
          email: "test@example.com",
          image: "https://example.com/avatar.jpg",
        },
        expires: new Date(Date.now() + 86400000).toISOString(),
        sessionId: "session-1",
        provider: "azure-ad",
        loginTime: Date.now(),
      },
      status: "authenticated",
      update: vi.fn(),
    });

    render(React.createElement(AuthButton));
    expect(screen.getByText("Test User")).toBeDefined();
    expect(screen.getByText("test@example.com")).toBeDefined();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeDefined();
  });

  it("should call signIn when Sign In button is clicked", async () => {
    const { userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    mockedUseSession.mockReturnValue({
      data: null,
      status: "unauthenticated",
      update: vi.fn(),
    });

    render(React.createElement(AuthButton));
    await user.click(screen.getByText("Sign In"));
    expect(signIn).toHaveBeenCalled();
  });

  it("should call signOut when Sign Out button is clicked", async () => {
    const { userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    mockedUseSession.mockReturnValue({
      data: {
        user: { id: "user-1", name: "Test User", email: "test@example.com" },
        expires: new Date(Date.now() + 86400000).toISOString(),
        sessionId: "session-1",
        provider: "azure-ad",
        loginTime: Date.now(),
      },
      status: "authenticated",
      update: vi.fn(),
    });

    render(React.createElement(AuthButton));
    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
  });

  it("should not render user image when image is not provided", () => {
    mockedUseSession.mockReturnValue({
      data: {
        user: {
          id: "user-1",
          name: "No Avatar",
          email: "noavatar@example.com",
        },
        expires: new Date(Date.now() + 86400000).toISOString(),
        sessionId: "session-1",
        provider: "azure-ad",
        loginTime: Date.now(),
      },
      status: "authenticated",
      update: vi.fn(),
    });

    const { container } = render(React.createElement(AuthButton));
    const images = container.querySelectorAll("img");
    expect(images.length).toBe(0);
  });
});
