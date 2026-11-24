import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScrollToBottomButtonProps {
  visible: boolean;
  onClick: () => void;
}

export function ScrollToBottomButton({
  visible,
  onClick,
}: ScrollToBottomButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Scroll to bottom"
      className={cn(
        "absolute bottom-4 left-1/2 -translate-x-1/2 z-10",
        "flex items-center justify-center",
        "size-8 rounded-full",
        "bg-background/90 border border-border shadow-md",
        "text-muted-foreground hover:text-foreground",
        "backdrop-blur-sm",
        "transition-all duration-200",
        visible
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 translate-y-2 pointer-events-none",
      )}
    >
      <ArrowDown className="size-4" />
    </button>
  );
}
