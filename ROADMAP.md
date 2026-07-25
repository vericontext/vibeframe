# VibeFrame Roadmap

This is a short public roadmap, not a release log. Completed work lives in
[CHANGELOG.md](CHANGELOG.md); active bugs and feature requests should live in
GitHub Issues.

## Now

- Stabilize the generation flow end to end: `vibe init --from` ->
  `vibe plan` -> `vibe build --dry-run --max-cost` -> `vibe build` ->
  `vibe render`.
- Keep `docs/cli-reference.md` generated from the live CLI schema.
- Tighten provider setup, `vibe doctor`, and dry-run behavior so paid calls are
  predictable before they run.
- Keep MCP and CLI command surfaces aligned.

## Next

- Improve image-to-video integration inside storyboard builds.
- Add better transcript and narration timing into scene composition prompts.
- Expand local/free fallbacks where provider APIs are optional.
- Improve render diagnostics for Chrome, FFmpeg, and Hyperframes failures.

## Later

- Public extension points for third-party providers.
- More resumable long-running project builds.
- Server-side rendering options for large jobs.

## Not Planned

- A separate chat UI as the primary product. VibeFrame stays CLI-first and
  agent-friendly.
- Replacing Hyperframes as the browser scene renderer. VibeFrame builds around
  that layer instead of competing with it.
