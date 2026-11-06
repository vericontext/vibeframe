/**
 * Promoting a take: put one take's output into a beat slot of a project.
 *
 * A build fills five slots per beat (narration, backdrop, keyframe, video,
 * music) and records each generation as a take. Regenerating a slot makes a
 * new take; the old one keeps its bytes under `.vibeframe/media/`. Promoting
 * an earlier take copies those bytes back into the slot and marks the slot's
 * metadata with the take id and the cue it was promoted under. Later builds
 * keep a promoted slot while the beat's cue is unchanged; editing the cue or
 * `vibe build --force` regenerates it.
 */

import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";

import { ExitCode, executorFailure, generalError, usageError, type ExecutorFailure, type StructuredError } from "../commands/output.js";
import { readAssetMetadata, slotCue, writeAssetMetadata } from "../commands/_shared/build-asset-metadata.js";
import { resolveTypedAssetReference } from "../commands/_shared/build-asset-reference.js";
import { parseStoryboard } from "../commands/_shared/storyboard-parse.js";
import { loadStoryboardMarkdown } from "../commands/_shared/storyboard-source.js";
import { beatTranscriptRelPath } from "../commands/_shared/transcribe-narration.js";
import { writeImageFile } from "../utils/image-file.js";
import { executeTakeShow } from "./query.js";
import { SLOT_KIND, TAKE_SLOTS, findProject, globalTakeStore, hashFile, takeMediaPath, type Take, type TakeSlot } from "./take.js";

export interface TakePromoteOptions {
  takeId: string;
  /** The directory the call runs from; the project is found around it. */
  cwd: string;
  /** The project to promote into, instead of the one around `cwd`. */
  projectDir?: string;
  /** The beat to fill. Default: the beat the take was made for. */
  beatId?: string;
  /** The slot to fill. Default: the slot the take was made for. */
  asset?: TakeSlot;
  dryRun?: boolean;
}

export interface TakePromoteResult {
  success: true;
  dryRun: boolean;
  projectDir: string;
  takeId: string;
  beatId: string;
  asset: TakeSlot;
  /** The slot file, relative to the project. */
  path: string;
  /** The take the slot held before, when a take filled it. */
  previousTakeId?: string;
  /** Where the bytes come from: the take's preserved copy, or its output file. */
  source: string;
}

function notFound(message: string, suggestion: string): StructuredError {
  return { success: false, error: message, code: "NOT_FOUND", exitCode: ExitCode.NOT_FOUND, suggestion, retryable: false };
}

/** The slot file a build reads for `asset` of `beatId`, for a take output with extension `ext`. */
function slotPath(asset: TakeSlot, beatId: string, ext: string): string | { error: string } {
  switch (asset) {
    case "narration":
      return ext === ".mp3" || ext === ".wav" ? `assets/narration-${beatId}${ext}` : { error: "a narration slot takes .mp3 or .wav audio" };
    case "music":
      return ext === ".mp3" ? `assets/music-${beatId}.mp3` : { error: "a music slot takes .mp3 audio" };
    case "video":
      return ext === ".mp4" ? `assets/video-${beatId}.mp4` : { error: "a video slot takes .mp4 video" };
    case "backdrop":
    case "keyframe":
      return `assets/${asset}-${beatId}.png`;
  }
}

/** The bytes of a take's output: its preserved copy, else its output file if unchanged since the take. */
async function takeBytes(take: Take, store: { projectDir?: string }): Promise<string | undefined> {
  const output = take.outputs[0];
  if (!output) return undefined;
  if (store.projectDir) {
    const preserved = takeMediaPath(store.projectDir, output);
    if (existsSync(preserved)) return preserved;
  }
  const path = isAbsolute(output.path) || !store.projectDir ? resolve(output.path) : join(store.projectDir, output.path);
  if (!existsSync(path)) return undefined;
  const now = await hashFile(path);
  return now.sha256 === output.sha256 ? path : undefined;
}

export async function executeTakePromote(options: TakePromoteOptions): Promise<TakePromoteResult | ExecutorFailure> {
  const projectDir = options.projectDir ? resolve(options.cwd, options.projectDir) : findProject(options.cwd);
  if (!projectDir || !existsSync(join(projectDir, "STORYBOARD.md"))) {
    return executorFailure(usageError("No VibeFrame project with a STORYBOARD.md here.", "Run inside a project, or pass --project <dir>."));
  }

  const found = await executeTakeShow(options.takeId, { cwd: projectDir });
  if (!found) {
    return executorFailure(notFound(`Take not found: ${options.takeId}`, "Run 'vibe take list' to see this project's takes."));
  }
  const { take } = found;
  // A project store is `<project>/.vibeframe/takes`; a take from the global store has absolute paths.
  const storeProject = found.store === globalTakeStore().dir ? undefined : dirname(dirname(found.store));

  const asset = options.asset ?? take.origin.asset;
  if (!asset) {
    return executorFailure(usageError(`Take ${take.id} was not made for a beat slot.`, `Pass --asset (${TAKE_SLOTS.join(", ")}).`));
  }
  if (SLOT_KIND[asset] !== take.kind) {
    return executorFailure(usageError(`A ${take.kind} take cannot fill a ${asset} slot.`, `A ${asset} slot takes a ${SLOT_KIND[asset]} take.`));
  }
  const beatId = options.beatId ?? take.origin.beatId;
  if (!beatId) {
    return executorFailure(usageError(`Take ${take.id} was not made for a beat.`, "Pass --beat <id>."));
  }
  if (take.status !== "completed" || take.outputs.length === 0) {
    return executorFailure(usageError(`Take ${take.id} has no output to promote (status ${take.status}).`, "Promote a completed take."));
  }

  const beats = parseStoryboard(await loadStoryboardMarkdown(projectDir)).beats;
  const beat = beats.find((b) => b.id === beatId);
  if (!beat) {
    return executorFailure(notFound(`Beat ${beatId} is not in STORYBOARD.md.`, `Beats: ${beats.map((b) => b.id).join(", ") || "none"}.`));
  }
  const cue = slotCue(beat.cues, asset);
  if (!cue) {
    return executorFailure(usageError(`Beat ${beatId} has no ${asset} cue, so a build would not use this slot.`, `Add a ${asset === "video" ? "video or keyframe" : asset} cue to beat ${beatId}.`));
  }
  if (asset !== "keyframe" && resolveTypedAssetReference(projectDir, asset, cue)) {
    return executorFailure(usageError(`Beat ${beatId}'s ${asset} cue names a file (${cue}); the build uses that file, not a take.`, `Replace the ${asset} cue with a prompt to fill the slot from takes.`));
  }

  const rel = slotPath(asset, beatId, extname(take.outputs[0].path).toLowerCase());
  if (typeof rel !== "string") return executorFailure(usageError(`Take ${take.id} cannot fill this slot: ${rel.error}.`));

  const source = await takeBytes(take, { projectDir: storeProject });
  if (!source) {
    return executorFailure(
      generalError(
        `The output of take ${take.id} is gone: no preserved copy, and ${take.outputs[0].path} is missing or changed.`,
        "Generate the slot again with 'vibe build'.",
      ),
    );
  }

  const previous = readAssetMetadata(projectDir, asset, beatId);
  const result: TakePromoteResult = {
    success: true,
    dryRun: options.dryRun === true,
    projectDir,
    takeId: take.id,
    beatId,
    asset,
    path: rel,
    ...(previous?.takeId && previous.takeId !== take.id ? { previousTakeId: previous.takeId } : {}),
    source,
  };
  if (options.dryRun) return result;

  const abs = join(projectDir, rel);
  await mkdir(dirname(abs), { recursive: true });
  if (asset === "backdrop" || asset === "keyframe") {
    await writeImageFile(abs, readFileSync(source));
  } else {
    await copyFile(source, abs);
  }
  if (asset === "narration") {
    // A narration of the other extension would shadow this one in the composition.
    for (const ext of [".mp3", ".wav"]) {
      const sibling = join(projectDir, `assets/narration-${beatId}${ext}`);
      if (sibling !== abs && existsSync(sibling)) await rm(sibling, { force: true });
    }
    // The word timings were for the narration this replaces; the next build transcribes again.
    await rm(join(projectDir, beatTranscriptRelPath(beatId)), { force: true });
  }
  await writeAssetMetadata({
    projectDir,
    kind: asset,
    beatId,
    cue,
    provider: take.provider,
    options: {},
    cacheKey: `take:${take.id}`,
    canonicalPath: rel,
    takeId: take.id,
    promotedCue: cue,
  });
  return result;
}
