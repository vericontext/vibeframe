/**
 * ai-helpers.ts - Shared utility functions used across AI commands.
 */

/** Format a duration in seconds to m:ss.s display format */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return `${mins}:${secs.padStart(4, "0")}`;
}
