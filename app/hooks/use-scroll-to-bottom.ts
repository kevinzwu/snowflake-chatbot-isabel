import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

const SCROLL_THRESHOLD = 150;

interface UseScrollToBottomReturn<T extends HTMLElement> {
  containerRef: RefObject<T | null>;
  endRef: RefObject<T | null>;
  showScrollButton: boolean;
  scrollToBottom: () => void;
}

export function useScrollToBottom<
  T extends HTMLElement,
>(): UseScrollToBottomReturn<T> {
  const containerRef = useRef<T>(null);
  const endRef = useRef<T>(null);
  const isAtBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const rafIdRef = useRef<number | null>(null);

  const checkIsAtBottom = useCallback((container: HTMLElement): boolean => {
    return (
      container.scrollTop + container.clientHeight >=
      container.scrollHeight - SCROLL_THRESHOLD
    );
  }, []);

  const scrollToBottom = useCallback(() => {
    const end = endRef.current;
    if (end) {
      end.scrollIntoView({ behavior: "smooth", block: "end" });
      isAtBottomRef.current = true;
      setShowScrollButton(false);
    }
  }, []);

  // Scroll event listener to track user scroll position
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (rafIdRef.current !== null) return;

      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        if (!containerRef.current) return;

        const atBottom = checkIsAtBottom(containerRef.current);
        isAtBottomRef.current = atBottom;
        setShowScrollButton(!atBottom);
      });
    };

    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [checkIsAtBottom]);

  // MutationObserver to auto-scroll only when user is at bottom
  useEffect(() => {
    const container = containerRef.current;
    const end = endRef.current;

    if (container && end) {
      const observer = new MutationObserver((mutationList) => {
        // Detect if any mutation is specifically toggling a <details> element
        const isDetailsToggle = mutationList.some((mutation) => {
          return (
            mutation.type === "attributes" &&
            (mutation.target as Element).tagName.toLowerCase() === "details" &&
            mutation.attributeName === "open"
          );
        });

        // Only auto-scroll if user is near the bottom and not a <details> toggle
        if (!isDetailsToggle && isAtBottomRef.current) {
          end.scrollIntoView({ behavior: "instant", block: "end" });
        }
      });

      observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });

      return () => observer.disconnect();
    }
  }, []);

  return { containerRef, endRef, showScrollButton, scrollToBottom };
}
