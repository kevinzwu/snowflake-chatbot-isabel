/**
 * Tests for utility functions
 */

import { cn } from "@/lib/utils";
import { describe, expect, it } from "vitest";

describe("cn() - class name merger", () => {
  it("should merge simple class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("should handle conditional classes via clsx", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("should resolve Tailwind conflicts (last wins)", () => {
    // tailwind-merge should resolve conflicting utilities
    expect(cn("p-4", "p-2")).toBe("p-2");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("should handle undefined and null values", () => {
    expect(cn("base", undefined, null, "end")).toBe("base end");
  });

  it("should handle empty string", () => {
    expect(cn("")).toBe("");
  });

  it("should handle no arguments", () => {
    expect(cn()).toBe("");
  });

  it("should handle array inputs", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
  });

  it("should handle object inputs", () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe("foo baz");
  });
});
