/**
 * Tests for Markdown component.
 *
 * Without rehype-raw, raw HTML in markdown is escaped as text by the parser.
 * This means XSS payloads in AI responses (vulnerability data) display as
 * readable text content rather than being parsed/stripped as HTML.
 */

import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

// Mock next/link to behave like production Next.js Link (requires href)
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => {
    if (!href) {
      throw new TypeError(
        "Cannot destructure property 'auth' of 'e' as it is undefined.",
      );
    }
    return React.createElement("a", { href, ...props }, children);
  },
}));

import { Markdown } from "../markdown";

describe("Markdown", () => {
  it("renders plain text", () => {
    render(<Markdown>Hello world</Markdown>);
    expect(screen.getByText("Hello world")).toBeDefined();
  });

  it("renders inline code with HTML as visible text", () => {
    const md = "Payload: `<script>alert(1)</script>`";
    const { container } = render(<Markdown>{md}</Markdown>);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain("<script>alert(1)</script>");
  });

  it("drops bare HTML outside code spans (standard markdown behavior)", () => {
    // Without rehype-raw, raw HTML blocks are dropped by the markdown parser.
    // This is fine — AI responses wrap payloads in backtick code spans.
    const md = "<script>alert('xss')</script>\n\nSafe text";
    const { container } = render(<Markdown>{md}</Markdown>);
    expect(container.textContent).toContain("Safe text");
    // No actual <script> element created
    expect(container.querySelector("script")).toBeNull();
  });

  it("drops bare HTML event handler payloads outside code spans", () => {
    // Bare HTML is dropped by markdown parser (no rehype-raw), preventing execution
    const md = "<img src=a onerror=alert(document.cookie)>";
    const { container } = render(<Markdown>{md}</Markdown>);
    // No actual <img> element is created
    expect(container.querySelector("img")).toBeNull();
  });

  it("preserves event handler payloads inside backtick code spans", () => {
    // This is the actual use case: AI wraps payloads in code spans
    const md = "Payload: `<img src=a onerror=alert(document.cookie)>`";
    const { container } = render(<Markdown>{md}</Markdown>);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain("onerror=alert(document.cookie)");
  });

  it("does not crash on partial streaming with unclosed backticks", () => {
    const partial = "- `<a onmouseover=alert(document.domain)>test</a>";
    expect(() => render(<Markdown>{partial}</Markdown>)).not.toThrow();
  });

  it("renders valid markdown links with Link component", () => {
    const md = "[example](https://example.com)";
    render(<Markdown>{md}</Markdown>);
    const link = screen.getByText("example");
    expect(link.closest("a")).not.toBeNull();
    expect(link.closest("a")?.getAttribute("href")).toBe("https://example.com");
  });

  it("handles the full XSS payload response without crashing or censoring", () => {
    const fullResponse = `Based on my analysis, here are the unique JavaScript payloads:

**Alert-based Payloads:**
- \`<script>alert(document.domain)</script>\`
- \`<script>alert(document.cookie)</script>\`
- \`<script>alert(1)</script>\`

**Event Handler Payloads:**
- \`<img src=a onerror=alert(document.cookie)>\`
- \`</title><img src=a onerror=alert(document.cookie)>\`
- \`<a onmouseover=alert(document.domain)>test</a>\`
- \`lokj0</title><img src=a onerror=alert(document.cookie)>elzrd\`

**URL-encoded Payload:**
- \`%3c%2ftitle%3e%3cimg%20src%3da%20onerror%3dalert(document.cookie)%3e\``;

    const { container } = render(<Markdown>{fullResponse}</Markdown>);
    expect(container.textContent).toContain("alert(document.domain)");
    expect(container.textContent).toContain("alert(document.cookie)");
    expect(container.textContent).toContain("<script>");
    expect(container.textContent).toContain("onerror=alert");
  });

  it("handles partial streaming content with unclosed backticks", () => {
    const partials = [
      "- `<script>alert(1)</script>",
      "- `<a onmouseover=alert(1)>test</a>",
      "- `<img src=a onerror=alert(1)>",
      "`<script>alert(document.domain)</script>",
      "<a>no href link</a>",
    ];

    for (const partial of partials) {
      expect(() => render(<Markdown>{partial}</Markdown>)).not.toThrow();
    }
  });

  it("does not execute script tags (no <script> element in DOM)", () => {
    const md = "<script>alert(1)</script>";
    const { container } = render(<Markdown>{md}</Markdown>);
    // Without rehype-raw, no actual <script> element is created
    expect(container.querySelector("script")).toBeNull();
  });
});
