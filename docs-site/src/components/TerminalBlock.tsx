import React, { useState } from 'react';

interface TerminalBlockProps {
  children: string;
  title?: string;
}

export function TerminalBlock({ children, title }: TerminalBlockProps): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    // Extract just the commands (remove prompt symbols)
    const commands = children
      .split('\n')
      .map(line => line.replace(/^\$\s*/, '').trim())
      .filter(line => line && !line.startsWith('#'))
      .join('\n');

    await navigator.clipboard.writeText(commands);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Parse the content to highlight prompts
  const lines = children.trim().split('\n');

  return (
    <div className="terminal-block">
      <div className="terminal-block__header">
        <div className="terminal-block__dots">
          <span className="terminal-block__dot terminal-block__dot--red" />
          <span className="terminal-block__dot terminal-block__dot--yellow" />
          <span className="terminal-block__dot terminal-block__dot--green" />
        </div>
        {title && <span className="terminal-block__title">{title}</span>}
        <button
          className={`terminal-block__copy ${copied ? 'terminal-block__copy--copied' : ''}`}
          onClick={handleCopy}
          aria-label="Copy to clipboard"
        >
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>
      <div className="terminal-block__content">
        <code>
          {lines.map((line, idx) => {
            const isCommand = line.startsWith('$');
            const isComment = line.startsWith('#');
            const isOutput = !isCommand && !isComment;

            return (
              <div key={idx} className="terminal-block__line">
                {isCommand && (
                  <>
                    <span className="terminal-block__prompt">$</span>
                    <span className="terminal-block__command">{line.slice(1).trim()}</span>
                  </>
                )}
                {isComment && (
                  <span className="terminal-block__comment">{line}</span>
                )}
                {isOutput && (
                  <span className="terminal-block__output">{line}</span>
                )}
              </div>
            );
          })}
        </code>
      </div>
    </div>
  );
}

export default TerminalBlock;
