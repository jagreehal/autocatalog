/** @jsxImportSource react */
import { highlightAll } from 'microlighter';
import { useEffect } from 'react';

export interface CodeProps {
  code: string;
  /** A microlighter grammar: `json`, `typescript`, `yaml`, `python`… */
  language: string;
  /** What the block is, for a screen reader moving between regions. */
  label?: string;
}

// The CSS Custom Highlight API keeps one registry per page, so highlighting one
// block's root would replace every other block's colours. Each change asks for
// one pass over the whole document, batched across the blocks that changed.
let pending = false;

function highlightPage() {
  // A browser without the Custom Highlight API shows the code plain.
  if (pending || !('Highlight' in globalThis)) return;

  pending = true;
  queueMicrotask(() => {
    pending = false;
    void highlightAll();
  });
}

/**
 * A block of code, highlighted by microlighter in the browser through the CSS
 * Custom Highlight API, so the markup stays one text node. The server renders
 * it plain; colours arrive once the island runs.
 */
export function Code({ code, language, label }: CodeProps) {
  useEffect(highlightPage, [code, language]);

  return (
    <pre
      // Wide code scrolls, so a keyboard reader has to be able to reach it.
      tabIndex={0}
      aria-label={label}
      className="m-0 overflow-x-auto rounded-lg border bg-muted p-4 font-mono text-xs leading-relaxed"
      data-syntax-theme="github"
    >
      <code className={`language-${language}`}>{code}</code>
    </pre>
  );
}

export default Code;
