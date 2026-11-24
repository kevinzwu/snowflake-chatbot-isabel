import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelSelector } from "./model-selector";

describe("ModelSelector", () => {
  it("should render with Sonnet selected by default", () => {
    render(<ModelSelector selectedModel="sonnet" onSelectModel={vi.fn()} />);

    expect(screen.getByText("Sonnet")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("should open dropdown when clicked", () => {
    render(<ModelSelector selectedModel="sonnet" onSelectModel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("should display all model options when open", () => {
    render(<ModelSelector selectedModel="sonnet" onSelectModel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button"));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
  });

  it("should call onSelectModel when an option is clicked", () => {
    const onSelectModel = vi.fn();
    render(
      <ModelSelector selectedModel="sonnet" onSelectModel={onSelectModel} />,
    );

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Haiku"));
    expect(onSelectModel).toHaveBeenCalledWith("haiku");
  });

  it("should close dropdown after selection", () => {
    render(<ModelSelector selectedModel="sonnet" onSelectModel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Opus"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("should show current selection in trigger", () => {
    render(<ModelSelector selectedModel="opus" onSelectModel={vi.fn()} />);

    expect(screen.getByRole("button")).toHaveTextContent("Opus");
  });

  it("should mark selected option with aria-selected", () => {
    render(<ModelSelector selectedModel="haiku" onSelectModel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button"));
    const options = screen.getAllByRole("option");
    const haikuOption = options.find((o) => o.textContent?.includes("Haiku"));
    expect(haikuOption).toHaveAttribute("aria-selected", "true");
  });

  it("should have accessible label", () => {
    render(<ModelSelector selectedModel="sonnet" onSelectModel={vi.fn()} />);

    expect(screen.getByLabelText("Select AI model")).toBeInTheDocument();
  });
});
