---
provider: openrouter
checked: 2026-10-04
env: [OPENROUTER_API_KEY]
models_endpoint: openrouter
models_in_use:
  - openrouter/auto             # agent default
models_recommended:
  - anthropic/claude-sonnet-5.5 # tool-capable pick for docs and examples
  - qwen/qwen3.8-flash          # cheap tool-capable pick
---

# OpenRouter

OpenRouter is an OpenAI-compatible router in front of hundreds of models.
VibeFrame uses it only as an LLM backend for `vibe agent -p openrouter` (the built-in agent loop), with `openrouter/auto` as the default model.

## Models

Prices are USD per 1M tokens (input / output), read from the live `/api/v1/models` listing (probe).
All rows below list `tools` and `tool_choice` in `supported_parameters` (probe).
398 of the 466 listed models advertise `tools` (probe).

| ID | Kind | Status | Price | Notes |
|---|---|---|---|---|
| `anthropic/claude-sonnet-5.5` | chat, reasoning | GA, added 2026-09-28 | $2 / $10 | 1M ctx; reasoning is mandatory, default effort `high` (probe) |
| `openai/gpt-6-luna` | chat, reasoning | GA, added 2026-09-22 | $0.10 / $0.50 | 1.05M ctx; `temperature` is not in `supported_parameters` (probe) |
| `deepseek/deepseek-v4.1-flash` | chat | GA, added 2026-09-10 | $0.30 / $1.20 | 1M ctx (probe) |
| `google/gemini-3.8-flash` | chat, reasoning | GA, added 2026-09-02 | $0.75 / $3.75 | 1M ctx, 65,536 max output; reasoning mandatory (probe) |
| `qwen/qwen3.8-flash` | chat | GA, added 2026-08-26 | $0.15 / $0.47 | 1M ctx (probe) |
| `z-ai/glm-5.3-flash` | chat, reasoning | GA, added 2026-08-26 | $0.15 / $0.50 | 1M ctx; reasoning mandatory (probe) |
| `moonshotai/kimi-k3` | chat, reasoning | GA, added 2026-07-16 | $3 / $15 | 1M ctx; default reasoning effort `max`, which is slow and costly in a loop (probe) |
| `anthropic/claude-sonnet-4.6` | chat | GA, added 2026-02-17 | $3 / $15 | The correct slug for the model our docs call `claude-sonnet-4-6` (probe) |
| `openrouter/auto` | router | GA | dynamic (listed as -1) | Our default; picks a model per prompt, no router fee (probe, docs) |

Slugs are `<org>/<model>` and the model part uses dots for versions, for example `anthropic/claude-sonnet-4.6` (docs).
The dashed form `anthropic/claude-sonnet-4-6` is absent from the listing (probe).
The public `GET /api/v1/models/anthropic/claude-sonnet-4-6/endpoints` route still resolved it to `anthropic/claude-sonnet-4.6` (probe), so the metadata route normalizes it.
Whether `chat/completions` accepts the dashed form was not tested (no paid call); use the listed dotted ID.
Suffix variants exist, such as `:batch`, `:free` and `:nitro` (probe, docs).
`expiration_date` on a listing entry is the date after which the model may be removed (docs); several Qwen and MiniMax slugs expire 2026-10-08 to 2026-10-09 (probe).

## API shape

- Base URL `https://openrouter.ai/api/v1`, OpenAI Chat Completions shape at `/chat/completions` (docs).
- Auth: `Authorization: Bearer <OPENROUTER_API_KEY>` (docs).
- Attribution: `HTTP-Referer` is the only header needed for app attribution; `X-OpenRouter-Title` sets the display name and `X-Title` is still accepted for backward compatibility (docs).
  Optional `X-OpenRouter-Categories` and `X-OpenRouter-App-Visibility` also exist (docs).
- Request fields that matter to us: `model`, `messages`, `tools`, `tool_choice`, plus routing controls `models` (fallback list) and `provider` (docs).
- Sync only for our use; streaming is SSE (docs).
- We read `choices[0].message.content`, `choices[0].message.tool_calls` and `choices[0].finish_reason`.
  `finish_reason` is normalized to `tool_calls`, `stop`, `length`, `content_filter` or `error`, with the raw value in `native_finish_reason` (docs).
- The response `model` field reports which model `openrouter/auto` actually picked (docs).
- Errors: `{"error": {"code", "message", "metadata"}}` with 400, 401, 402 (no credits), 403 (moderation or guardrail), 408, 429, 502 (model down), 503 (no provider meets routing requirements) (docs).
- Free GETs: `/api/v1/models` (docs say auth required, but the listing and per-model `endpoints` route answered without a key) and `/api/v1/key` for credit usage and limits (probe).

## Gotchas

- Non-streaming requests can return HTTP 200 with an `error` object and partial or empty content; check for `error` before reading `choices[0]` (docs).
- Mid-stream failures arrive as SSE events with `finish_reason: "error"` while the status stays 200 (docs).
- `provider.require_parameters` defaults to `false`, so a request can route to a provider that silently ignores unsupported parameters (docs).
  `tools`, `response_format` and `verbosity` get a soft preference only; a model is not dropped if none of its providers support them (docs).
- If the chosen model has no native tool support, OpenRouter does not route around it; pick a model that lists `tools` (docs).
- `tools` must be sent on every request in a tool loop, including follow-ups, because the router validates the schema each call (docs).
- Parallel tool calls are on by default; send `parallel_tool_calls: false` to force one call per turn (docs).
- For reasoning models, OpenRouter recommends passing `reasoning_details` back on assistant turns during tool loops to keep reasoning continuity (docs); our adapter drops them.
- `openrouter/auto` can pick a model without tool support or with very different cost per turn, which makes agent runs non-reproducible; `allowed_models` with wildcards narrows the pool (docs).
- Pricing is pass-through with no markup on model usage, counted with each model's native tokenizer (docs).
  Credit purchases carry a 5.5% card fee ($0.80 minimum) and BYOK usage carries a 5% fee after a monthly allowance (docs).
- `data_collection` defaults to `allow`; set `provider.data_collection: "deny"` or `zdr: true` to exclude providers that retain or train on prompts (docs).

## In our code

- `packages/cli/src/agent/adapters/openrouter.ts:19` - default model `openrouter/auto`.
- `packages/cli/src/agent/adapters/openrouter.ts:22-29` - OpenAI SDK client, base URL, `HTTP-Referer` and legacy `X-Title` headers.
- `packages/cli/src/agent/adapters/openrouter.ts:90-95` - `chat.completions.create` with `tools` and `tool_choice: "auto"`, no `provider` or `models` routing options.
- `packages/cli/src/agent/adapters/openrouter.ts:97` - reads `response.choices[0]` without checking for an `error` body.
- `packages/cli/src/agent/adapters/openrouter.ts:106` - `JSON.parse(tc.function.arguments)` with no try/catch.
- `packages/cli/src/agent/adapters/index.ts:55-57` - adapter factory.
- `packages/cli/src/commands/agent.ts:117`, `:366-367`, `:386` - provider key mapping, `--provider` and `--model` flags.
- `packages/ai-providers/src/api-keys.ts:133-139`, `:180-182` - key registry entry and virtual provider.
- `packages/cli/src/utils/api-key.ts:18`, `packages/cli/src/utils/key-live-test.ts:101-108` - env mapping and live key check against `/api/v1/models`.
- `packages/cli/src/agent/adapters/openrouter.test.ts:60` - test uses the dashed slug `anthropic/claude-sonnet-4-6`.
- `MODELS.md:61-72` - docs table with the dashed slug and older examples (`openai/gpt-5-mini`, `google/gemini-2.5-flash`, `meta-llama/llama-4-scout`, `deepseek/deepseek-r1`, all still listed).

## Recommended changes

1. Fix the slug in `MODELS.md:66,72` and `openrouter.test.ts:60` to `anthropic/claude-sonnet-4.6`, or better, recommend a current tool-capable model such as `anthropic/claude-sonnet-5.5` or a cheap one such as `qwen/qwen3.8-flash`.
2. Guard the response: treat a body with `error` or an empty `choices` array as an error, and map `finish_reason: "error"`.
3. Wrap the tool-argument `JSON.parse` so malformed arguments from weaker models become a recoverable tool error instead of a crash.
4. Send `provider: { require_parameters: true }` when tools are present so requests never land on a provider that ignores `tools`.
5. Reconsider `openrouter/auto` as the agent default, or constrain it with `allowed_models`, since cost and tool support vary per pick.
6. Rename `X-Title` to `X-OpenRouter-Title` (the old name still works).
7. Preserve `reasoning_details` on assistant turns when the model returns them.

## Sources

- https://openrouter.ai/docs/api-reference/overview (2026-10-04)
- https://openrouter.ai/docs/guides/features/tool-calling (2026-10-04)
- https://openrouter.ai/docs/features/model-routing (2026-10-04)
- https://openrouter.ai/docs/guides/routing/provider-selection.md (2026-10-04)
- https://openrouter.ai/docs/app-attribution.md (2026-10-04)
- https://openrouter.ai/docs/api_reference/errors-and-debugging.md (2026-10-04)
- https://openrouter.ai/docs/guides/best-practices/reasoning-tokens.md (2026-10-04)
- https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties.md (2026-10-04)
- https://openrouter.ai/docs/faq (2026-10-04)
- Probe: `GET /api/v1/models` saved as `or.json`, `GET /api/v1/models/{slug}/endpoints` for dashed, dotted and auto slugs, `GET /api/v1/key` (2026-10-04)
