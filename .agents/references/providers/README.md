# Provider References

Working notes for agents that write or change provider integrations.
One file per provider: what models it offers, how its API behaves, which parameters it rejects, and where our code calls it.

These files are not published docs and not a model catalog.
They summarize official provider documentation and live probes, with a source link for every claim.
Provider APIs change every few weeks, so treat any file whose `checked` date is old as a lead to re-verify, not as truth.

Run `pnpm providers:check` to see which model IDs our code uses that a provider no longer lists, and which files are stale.
A listed ID is not proof that a model still works: OpenAI still lists shut-down models such as `sora-2`, and Gemini still lists image previews past their shutdown date.
Deprecation dates in these files are the stronger signal.

## File format

Every file starts with this frontmatter:

```yaml
---
provider: anthropic            # file name without .md
checked: 2026-10-04            # date the facts below were last verified
env: [ANTHROPIC_API_KEY]       # env vars our code reads for this provider
models_endpoint: anthropic     # live listing probe used by providers:check, or none
models_in_use:                 # IDs our source calls today, most important first
  - claude-sonnet-4-6          # default: agent, storyboard, translate-srt
models_recommended:            # IDs to move to, each noting what it replaces
  - claude-sonnet-5-5          # replaces claude-sonnet-4-6
---
```

`models_in_use` describes the code as it is, so it lists old models until the code moves; it is what `providers:check` watches for disappearing IDs.
`models_recommended` is where the code should go; `providers:check` verifies those IDs exist too.
Use `[]` when a list is empty, and a trailing `# comment` to say what each ID is for.

`models_endpoint` is one of `anthropic`, `openai`, `gemini`, `xai`, `openrouter`, or `none`.

Then these sections, in order:

1. `# <Provider>` and one or two sentences on what VibeFrame uses it for.
2. `## Models` - a table of the models we use plus the current models worth knowing: ID, kind, status (GA / preview / deprecated + shutdown date), price, notes. Newest first.
3. `## API shape` - base URL, auth header, the request fields that matter, sync vs async (submit/poll), the response field we read, and error format.
4. `## Gotchas` - rejected or deprecated parameters, content policies, limits, silent redirects. These are the facts that break integrations.
5. `## In our code` - file paths (and line hints) that call this provider or hardcode its model IDs.
6. `## Recommended changes` - what our code should change, most urgent first.
7. `## Sources` - pages actually opened, with the date.

Mark how each fact was established:

- **(probe)** - observed with a live API call from this repo's keys.
- **(docs)** - read on the provider's own documentation, pricing, or changelog page.
- **(secondary)** - only found in third-party coverage. Re-verify before relying on it.

Summarize and link; do not paste provider documentation verbatim.
