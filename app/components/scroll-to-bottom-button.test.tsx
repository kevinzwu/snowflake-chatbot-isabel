import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScrollToBottomButton } from "./scroll-to-bottom-button";

describe("ScrollToBottomButton", () => {
  it("should render with aria-label", () => {
    render(<ScrollToBottomButton visible={true} onClick={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Scroll to bottom" }),
    ).toBeInTheDocument();
  });

  it("should be visible when visible prop is true", () => {
    render(<ScrollToBottomButton visible={true} onClick={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Scroll to bottom" });
    expect(button.className).toContain("opacity-100");
    expect(button.className).toContain("pointer-events-auto");
  });

  it("should be hidden when visible prop is false", () => {
    render(<ScrollToBottomButton visible={false} onClick={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Scroll to bottom" });
    expect(button.className).toContain("opacity-0");
    expect(button.className).toContain("pointer-events-none");
  });

  it("should call onClick when clicked", () => {
    const handleClick = vi.fn();
    render(<ScrollToBottomButton visible={true} onClick={handleClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Scroll to bottom" }));
    expect(handleClick).toHaveBeenCalledOnce();
  });
});
