/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Element, Root, Text } from "hast";
import Link from "next/link";
import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { citationsColorMap } from "../functions/postProcessAgentText";

const components: Partial<Components> = {
  table: ({ ...props }) => (
    <div className="max-w-[685px] max-h-[443px] overflow-y-scroll overflow-x-scroll mt-2">
      <table {...props} className="w-full" />
    </div>
  ),
  th: ({ ...props }) => (
    <th
      {...props}
      className="px-2 py-1 border border-border bg-muted text-left leading-relaxed text-xs font-medium text-muted-foreground"
    />
  ),
  td: ({ ...props }) => (
    <td
      {...props}
      className="px-2 py-1 border border-border leading-relaxed text-sm"
    />
  ),
  pre: ({ children }: any) => <>{children}</>,
  ol: ({ children, ...props }: any) => {
    return (
      <ol {...props} className="list-decimal list-outside ml-4">
        {children}
      </ol>
    );
  },
  li: ({ children, ...props }: any) => {
    return (
      <li {...props} className="py-1">
        {children}
      </li>
    );
  },
  ul: ({ children, ...props }: any) => {
    return (
      <ul {...props} className="list-decimal list-outside ml-4">
        {children}
      </ul>
    );
  },
  strong: ({ children, ...props }: any) => {
    return (
      <span {...props} className="font-medium">
        {children}
      </span>
    );
  },
  a: ({ children, href, ...props }: any) => {
    // During streaming, incomplete backtick pairs can cause rehype-raw to parse
    // XSS payloads (e.g. <a onmouseover=...>text</a>) as real HTML elements.
    // After sanitization the <a> has no href, which crashes Next.js Link.
    if (!href) {
      return <span>{children}</span>;
    }
    return (
      <Link
        {...props}
        href={href}
        className="text-blue-500 hover:underline"
        target="_blank"
        rel="noreferrer"
      >
        {children}
      </Link>
    );
  },
  h1: ({ children, ...props }: any) => {
    return (
      <h1 className="text-3xl font-semibold mt-6 mb-2" {...props}>
        {children}
      </h1>
    );
  },
  h2: ({ children, ...props }: any) => {
    return (
      <h2 className="text-2xl font-semibold mt-6 mb-2" {...props}>
        {children}
      </h2>
    );
  },
  h3: ({ children, ...props }: any) => {
    return (
      <h3 className="text-xl font-semibold mt-6 mb-2" {...props}>
        {children}
      </h3>
    );
  },
  h4: ({ children, ...props }: any) => {
    return (
      <h4 className="text-lg font-semibold mt-6 mb-2" {...props}>
        {children}
      </h4>
    );
  },
  h5: ({ children, ...props }: any) => {
    return (
      <h5 className="text-base font-semibold mt-6 mb-2" {...props}>
        {children}
      </h5>
    );
  },
  h6: ({ children, ...props }: any) => {
    return (
      <h6 className="text-sm font-semibold mt-6 mb-2" {...props}>
        {children}
      </h6>
    );
  },
};

/**
 * Custom rehype plugin to convert citation markers (【†N†】) into styled span elements.
 * This replaces the need for rehype-raw by handling citation rendering at the AST level,
 * preventing any raw HTML from being parsed (which eliminates XSS vectors).
 */
function rehypeCitations() {
  const CITATION_PATTERN = /【†(\d+)†】/g;

  return (tree: Root): void => {
    function processNode(node: Root | Element): void {
      if (!node.children) return;

      const newChildren: (Element | Text)[] = [];

      for (const child of node.children) {
        if (child.type === "text") {
          const text = child.value;
          CITATION_PATTERN.lastIndex = 0;

          if (!CITATION_PATTERN.test(text)) {
            newChildren.push(child);
            continue;
          }

          CITATION_PATTERN.lastIndex = 0;
          let lastIndex = 0;
          let match;

          while ((match = CITATION_PATTERN.exec(text)) !== null) {
            if (match.index > lastIndex) {
              newChildren.push({
                type: "text",
                value: text.slice(lastIndex, match.index),
              });
            }

            const number = Number(match[1]);
            const colors = citationsColorMap[number] || citationsColorMap[1];

            newChildren.push({
              type: "element",
              tagName: "span",
              properties: {
                className: `cursor-default rounded-full shrink-0 size-5 inline-flex items-center justify-center ${colors[0]} ${colors[1]} text-xs font-semibold`,
              },
              children: [{ type: "text", value: String(number) }],
            });

            lastIndex = match.index + match[0].length;
          }

          if (lastIndex < text.length) {
            newChildren.push({
              type: "text",
              value: text.slice(lastIndex),
            });
          }
        } else if (child.type === "element") {
          processNode(child);
          newChildren.push(child);
        } else {
          newChildren.push(child as any);
        }
      }

      node.children = newChildren as any;
    }

    processNode(tree);
  };
}

const remarkPlugins = [remarkGfm];
// No rehype-raw and no rehype-sanitize: the markdown parser already escapes
// raw HTML as text, so vulnerability payloads display as readable content.
// rehypeCitations converts 【†N†】 markers into styled spans at the AST level.
const rehypePlugins = [rehypeCitations] as const;

const NonMemoizedMarkdown = ({ children }: { children: string }) => {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins as any}
      components={components}
    >
      {children}
    </ReactMarkdown>
  );
};

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);
