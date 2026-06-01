/**
 * SpokenText (#241)
 *
 * Renders text dimmed and lights each word to full opacity as it is spoken,
 * driven by an absolute character offset (`spokenChar`) that maps the audio
 * playhead into the text. Shared by the face-view teleprompter overlay and the
 * chat bubble so both surfaces highlight identically.
 *
 * Word-level: words snap to three states based on the cursor — already spoken
 * (full), currently speaking (full + soft glow), upcoming (dimmed). On barge-in
 * the cursor freezes, so the highlight stops exactly where the audio stopped.
 */

import React, { useMemo } from 'react';

interface Token {
  text: string;
  start: number;
  end: number;
  isWord: boolean;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /\s+|[^\s]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
      isWord: !/^\s+$/.test(m[0]),
    });
  }
  return tokens;
}

interface SpokenTextProps {
  text: string;
  /** Absolute char offset spoken so far; words up to here are lit. */
  spokenChar: number;
  /** Opacity for not-yet-spoken words. */
  dimOpacity?: number;
}

const SpokenText: React.FC<SpokenTextProps> = ({ text, spokenChar, dimOpacity = 0.35 }) => {
  const tokens = useMemo(() => tokenize(text), [text]);
  return (
    <>
      {tokens.map((tok, i) => {
        if (!tok.isWord) return <span key={i}>{tok.text}</span>;
        // Light a word once the cursor passes its midpoint, so the highlight
        // tracks the word being voiced rather than lagging a full word behind.
        const midpoint = tok.start + (tok.end - tok.start) / 2;
        const spoken = spokenChar >= midpoint;
        const active = !spoken && spokenChar >= tok.start;
        return (
          <span
            key={i}
            className="transition-opacity duration-200 ease-out"
            style={{
              opacity: spoken ? 1 : active ? 0.85 : dimOpacity,
              textShadow: active ? '0 0 12px currentColor' : undefined,
            }}
          >
            {tok.text}
          </span>
        );
      })}
    </>
  );
};

export default SpokenText;
