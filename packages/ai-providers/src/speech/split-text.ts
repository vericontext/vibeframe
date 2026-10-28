/**
 * Split narration into chunks of whole sentences, each at most `maxChars`
 * long, for speech models that cap input or output length per request.
 * A sentence longer than that is split at clause punctuation, then at spaces.
 */
export function splitSpeechText(text: string, maxChars: number): string[] {
  const pieces = (part: string, pattern: RegExp): string[] =>
    part.length <= maxChars ? [part] : part.split(pattern).filter((p) => p.trim().length > 0);
  const units = text
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .flatMap((sentence) => pieces(sentence, /(?<=[,;:])\s+/))
    .flatMap((clause) => {
      if (clause.length <= maxChars) return [clause];
      const words: string[] = [];
      let line = "";
      for (const word of clause.split(/\s+/)) {
        if (line && line.length + word.length + 1 > maxChars) {
          words.push(line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      if (line) words.push(line);
      return words;
    });
  const chunks: string[] = [];
  for (const unit of units) {
    const last = chunks.at(-1);
    if (last !== undefined && last.length + unit.length + 1 <= maxChars) {
      chunks[chunks.length - 1] = `${last} ${unit}`;
    } else {
      chunks.push(unit);
    }
  }
  return chunks;
}
