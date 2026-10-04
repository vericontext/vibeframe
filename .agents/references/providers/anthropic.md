---
provider: anthropic
checked: 2026-10-04
env: [ANTHROPIC_API_KEY]
models_endpoint: anthropic
models_in_use:
  - claude-sonnet-4-6           # default: agent, storyboard, translate-srt, motion `sonnet`
  - claude-opus-4-7             # motion `opus`
  - claude-opus-4-6             # motion `opus-4-6` (legacy alias)
models_recommended:
  - claude-sonnet-5-5           # replaces claude-sonnet-4-6, after the agent adapter keeps thinking blocks
  - claude-opus-5-5             # replaces claude-opus-4-7 and claude-opus-4-6
---

# Anthropic

VibeFrame calls the Claude Messages API for the built-in agent loop, Remotion motion code generation, storyboard and narration analysis, viral/highlight analysis, SRT translation, and single-frame vision analysis (B-roll tagging, reframe, color grade).
Claude reads text and images only; it never sees video, so every video task first extracts frames or transcripts (docs).

## Models

Prices are USD per 1M input / output tokens on the Claude API.
"Retires" is Anthropic's "not sooner than" commitment unless marked as a fixed date.

| ID | Kind | Status | Price | Notes |
|---|---|---|---|---|
| `claude-sonnet-5-5` | text+image | GA, latest, retires >= 2027-09-28 | $2 / $10 | 1M context, 128K out, adaptive thinking on by default, default effort `high` (docs) |
| `claude-opus-5-5` | text+image | GA, latest, retires >= 2027-09-22 | $4 / $20 | Thinking always on, default effort `medium`, cache read 5% of input (docs) |
| `claude-fable-5-1` | text+image | GA, latest, retires >= 2027-09-01 | $10 / $50 | Thinking always on, default effort `high`, for long-horizon agentic work (docs) |
| `claude-sonnet-5` | text+image | Legacy, retires >= 2027-06-30 | $2 / $10 | Accepts `thinking: disabled` (docs) |
| `claude-opus-5` | text+image | Legacy, retires >= 2027-07-24 | $5 / $25 | (docs) |
| `claude-opus-4-8` | text+image | Legacy, retires >= 2027-05-28 | $5 / $25 | (docs) |
| `claude-opus-4-7` | text+image | Legacy, retires >= 2027-04-16 | $5 / $25 | **In use** (motion `opus` alias). New tokenizer, about 30% more tokens per text (docs) |
| `claude-opus-4-6` | text+image | Legacy, retires >= 2027-02-05 | $5 / $25 | **In use** (motion `opus-4-6` alias) (docs) |
| `claude-sonnet-4-6` | text+image | Legacy, retires >= 2027-02-17 | $3 / $15 | **In use**, our default everywhere. Old tokenizer (docs) |
| `claude-sonnet-4-5-20250929` | text+image | Deprecated, retires 2026-11-30 | $3 / $15 | Replacement `claude-sonnet-5-5` (docs) |
| `claude-opus-4-5-20251101` | text+image | Legacy, retires >= 2026-11-24 | $5 / $25 | 200K context, 64K out (probe) |
| `claude-haiku-4-5-20251001` | text+image | GA, retires >= 2026-10-15 | $1 / $5 | 200K context, 64K out, extended thinking only, no effort param. Alias `claude-haiku-4-5` (docs) |

Retired on the Claude API: Opus 4.1 (2026-08-05), Sonnet 4 and Opus 4 (2026-06-15), Sonnet 3.7 and Haiku 3.5 (2026-02-19), Haiku 3 (2026-04-20) (docs).
`GET /v1/models` returned 13 models on 2026-10-04, from `claude-sonnet-5-5` down to `claude-sonnet-4-5-20250929` (probe).
Every model ID from the 4.6 generation on is a dateless pinned snapshot, not a moving alias (docs).

## API shape

- Endpoint: `POST https://api.anthropic.com/v1/messages`, synchronous (docs).
- Auth headers: `x-api-key: $ANTHROPIC_API_KEY` and `anthropic-version: 2023-06-01` (docs).
- Request fields that matter: `model`, `max_tokens` (required), `system`, `messages`, `tools`, `tool_choice`, `thinking`, `output_config` (effort, structured output format) (docs).
- Images go in a user `content` array as `{type: "image", source: {type: "base64", media_type, data}}`; `url` and Files API `file_id` sources also work on the Claude API (docs).
- Response: `content` is an array of typed blocks (`text`, `tool_use`, `thinking`, `redacted_thinking`); always select by `type`, never by index (docs).
- `stop_reason` values we branch on: `end_turn`, `tool_use`, `max_tokens`; newer models can also return `refusal` with HTTP 200 and a `stop_details` category (docs).
- Errors: JSON `{type: "error", error: {type, message}, request_id}`; 400 `invalid_request_error`, 401, 402 `billing_error`, 403, 404, 413 `request_too_large`, 429, 500, 504, 529 `overloaded_error` (docs).
- Request size cap is 32 MB on the Messages API (docs).
- Model discovery: `GET /v1/models` returns `max_input_tokens`, `max_tokens`, and a `capabilities` object per model, including which thinking types and effort levels it accepts (probe).

## Gotchas

- **`temperature`, `top_p`, `top_k` are rejected** with 400 when set to a non-default value on Opus 4.7 and every later model (docs).
  Live: `temperature: 0.7` returned "`temperature` is deprecated for this model." on `claude-opus-4-7`, `claude-opus-5-5`, and `claude-sonnet-5-5`, and was accepted on `claude-sonnet-4-6` (probe).
- **Thinking cannot be disabled** on Fable 5.1, Fable 5, and Opus 5.5; `thinking: {type: "disabled"}` returns 400 (docs).
  Sonnet 5.5 also rejects `disabled`; send `{type: "between_tools"}` instead, valid only at effort `high` or below (docs).
- **`thinking: {type: "enabled", budget_tokens}` returns 400** on Opus 4.7 and later; use `{type: "adaptive"}` plus `output_config.effort` (docs).
  Haiku 4.5, Sonnet 4.5, and Opus 4.5 are the reverse: they reject `adaptive` (docs).
  The `/v1/models` capabilities agree: `thinking.types.enabled.supported` is false for every model from Opus 4.7 up (probe).
- **Forced tool use is rejected** on Opus 5.5, Sonnet 5.5, and Fable 5.1: `tool_choice` `any` or `tool` returns 400, including on token counting (docs).
  Use `auto` plus `strict: true` tools, or structured outputs (docs).
- **Thinking tokens count toward `max_tokens`.** On models with thinking on by default, a small `max_tokens` can end in `stop_reason: "max_tokens"` with no text block (docs).
  Our callers use 2048 and 4096, which is fine on Sonnet 4.6 (thinking off by default) but tight for Sonnet 5.5 or Opus 5.5.
- **Thinking blocks must be echoed back unmodified** in tool-use loops; editing, reordering, filtering, or rebuilding the assistant turn returns 400 (docs).
  On Fable 5.1, Opus 5.5, and Sonnet 5.5, a replayed thinking block is also bound to the unchanged prefix (system, tools, earlier messages); accounts created on or after 2026-08-31 get a 400 if that prefix changed (docs).
- **Text between tool calls moves into `thinking` blocks** on Sonnet 5.5 and Opus 5.5, and with the default `display: "omitted"` that text is empty (docs).
- **Assistant prefill is rejected** on Claude 4.6 and later models (docs).
- **`output_format` is deprecated**; structured outputs now use `output_config.format` (docs).
- **Image limits:** JPEG, PNG, GIF, WebP; 10 MB per image (base64) on the Claude API; max 8000x8000 px; 600 images per request (100 on 200K-context models) (docs).
  Over 20 images in one request triggers a stricter per-image dimension cap; keep each image at or under 2000 px or send 20 or fewer (docs).
  Images are downscaled to 1568 px long edge (1568 visual tokens) on standard models and 2576 px (4784 tokens) on Claude 4.7 and later; cost is `ceil(w/28) * ceil(h/28)` tokens (docs).
  Animated GIFs only contribute their first frame (docs).
- **No video or audio input** on any current model; input is text and images only (docs).
- **Dated IDs that never existed 404**: `claude-sonnet-4-6-20250514` returned 404 while `claude-sonnet-4-6`, `claude-opus-4-7`, and `claude-opus-4-6` returned 200 (probe).
- **Tokenizer change:** Claude 4.7 and later produce about 30% more tokens for the same text, so cost estimates based on 4.6 undercount (docs).

## In our code

- `packages/ai-providers/src/claude/ClaudeProvider.ts:133` base URL; `:134` default model `claude-sonnet-4-6`; `:137-141` `MOTION_MODELS` (`claude-sonnet-4-6`, `claude-opus-4-7`, `claude-opus-4-6`).
- `packages/ai-providers/src/claude/ClaudeProvider.ts:245` `parseCommand` and `:326` `autoEdit` call `/messages` directly with `max_tokens: 2048`.
- `packages/ai-providers/src/claude/claude-api.ts:21` shared `callClaude()`: `anthropic-version: 2023-06-01`, no `thinking`, no `temperature`, returns the first `text` block.
- `packages/ai-providers/src/claude/claude-motion.ts:54`, `:138`, `:192` motion and storyboard calls (comment at `:190` explains why `temperature` was removed).
- `packages/ai-providers/src/claude/claude-analysis.ts:136-145` and `claude-visual-fx.ts:299-308` send base64 `image` blocks (vision); `claude-viral.ts:93`, `:164`, `:221` text-only analysis.
- `packages/cli/src/agent/adapters/claude.ts:18` default `claude-sonnet-4-6`; `:45-90` rebuilds history from text and `tool_use` only (drops thinking blocks); `:105` `messages.create` with `max_tokens: 4096` and `tool_choice` unset.
- `packages/cli/src/commands/_shared/edit/translate-srt.ts:126-148` direct fetch with `claude-sonnet-4-6`, `max_tokens: 4096`.
- `packages/cli/src/commands/ai-motion.ts:66-68` `MODEL_MAP` duplicates the motion model IDs.
- `packages/cli/src/utils/api-key.ts:10` maps `ANTHROPIC_API_KEY` to the `anthropic` config key.

## Recommended changes

1. Make `ClaudeAdapter` keep the raw assistant `content` array (including `thinking` and `redacted_thinking` blocks) and replay it verbatim, before anyone points `setModel()` at Sonnet 5.5, Opus 5.5, or Fable 5.1; today it would 400 on the second tool turn.
2. Before moving the default off `claude-sonnet-4-6`, raise `max_tokens` (or set `output_config.effort` to `low`/`medium`, or `between_tools` on Sonnet 5.5) so thinking cannot starve the text block, and handle `stop_reason: "refusal"`.
3. Then move the default to `claude-sonnet-5-5`: it is cheaper than Sonnet 4.6 ($2/$10 vs $3/$15) and retires a year later.
4. Point the motion `opus` alias at `claude-opus-5-5` ($4/$20, cheaper than Opus 4.7 at $5/$25) once item 2 is done, and drop `opus-4-6`.
5. Collapse the model IDs duplicated across `ClaudeProvider.MOTION_MODELS`, `ai-motion.ts MODEL_MAP`, `translate-srt.ts`, and the adapter into one constant module so the next bump is a one-line change.
6. Never add `temperature`, `top_p`, `top_k`, forced `tool_choice`, `thinking: disabled`, `budget_tokens`, or assistant prefill to any Claude call path.

## Sources

All opened 2026-10-04.

- https://platform.claude.com/docs/en/about-claude/models/overview (redirects to /docs/en/models/overview)
- https://platform.claude.com/docs/en/about-claude/model-deprecations
- https://platform.claude.com/docs/en/about-claude/pricing
- https://platform.claude.com/docs/en/models/opus-5-5/migration-guide
- https://platform.claude.com/docs/en/models/sonnet-5-5/overview
- https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5
- https://platform.claude.com/docs/en/models/fable-5-1/overview
- https://platform.claude.com/docs/en/build-with-claude/vision
- https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting
- https://platform.claude.com/docs/en/api/errors
- Live probe from this repo's key: `GET /v1/models`, `GET /v1/models/{id}`, and `POST /v1/messages` with `temperature` on 4.6, 4.7, and 5.5 models.
