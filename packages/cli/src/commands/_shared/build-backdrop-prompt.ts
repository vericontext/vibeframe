/**
 * Convert a storyboard `backdrop` cue into a safer image-generation prompt.
 *
 * Backdrops are normally background plates; scene HTML owns the exact text,
 * logos, charts, and UI. Keeping that contract explicit reduces unrelated
 * product-photo drift and avoids generated typography competing with overlays.
 */
export function augmentBackdropPrompt(cue: string): string {
  const trimmed = cue.trim();
  const lower = trimmed.toLowerCase();
  const requestsTextOrMarks =
    /\b(text|typography|title|headline|label|caption|logo|logos|wordmark|brand mark|brand marks)\b/.test(lower);
  const forbidsTextOrMarks =
    /\b(no|without|avoid)\s+(readable\s+)?(text|typography|titles?|headlines?|labels?|captions?|brand\s+logos?|logos?|wordmarks?|brand\s+marks?)\b/.test(
      lower
    );
  const allowsTextOrMarks = requestsTextOrMarks && !forbidsTextOrMarks;
  const overlayContract = allowsTextOrMarks
    ? "The image is a video background or end-card plate; do not add any text, logos, charts, or UI beyond what the scene cue explicitly requests."
    : "The image is a background only; HTML overlays will provide all final text, charts, logos, and UI labels.";
  const textRule = allowsTextOrMarks
    ? "If text, logos, or brand marks are explicitly requested, keep them minimal, legible, and do not invent extras."
    : "No readable text, labels, UI copy, logos, brand marks, watermarks, or invented typography.";

  return [
    "Create a 16:9 video background plate for a HyperFrames scene.",
    overlayContract,
    `Scene cue: ${trimmed}`,
    textRule,
    "Avoid unrelated consumer product photography, shoes, packaging, food, people, celebrity faces, advertisements, and random objects unless explicitly requested by the scene cue.",
    "Leave generous negative space for overlay text and cards. Keep the result topic-aligned, editorial, cinematic, and non-distracting.",
  ].join(" ");
}
