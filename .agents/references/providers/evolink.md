---
provider: evolink
checked: 2026-10-04
env: [EVOLINK_API_KEY]
models_endpoint: none
models_in_use:
  - gpt-5.2                     # agent default
models_recommended:
  - gemini-3.8-flash            # replaces gpt-5.2; tools work on Chat Completions
  - claude-sonnet-5-5           # alternative default
---

# Evolink

Evolink is a paid gateway that exposes OpenAI-, Anthropic- and Gemini-compatible endpoints for many vendors' models behind one key.
VibeFrame uses only its OpenAI-compatible Chat Completions endpoint as an LLM backend for `vibe agent -p evolink`, defaulting to `gpt-5.2`.

## Models

Prices are USD per 1M tokens (input / output), converted from the per-1K `price_range.min_usd` values in the anonymous pricing catalog (probe).
The catalog is a pricing list, not the authenticated `/v1/models` listing, so presence there does not prove a model is callable.

| ID | Kind | Status | Price | Notes |
|---|---|---|---|---|
| `gpt-6.1-sol` | chat, reasoning | GA, released 2026-09-29 | $1.80 / $9.00 | Function tools only via Responses; no `reasoning_effort: "none"` (docs) |
| `gpt-6-sol` | chat, reasoning | GA, released 2026-09-22 | $1.80 / $9.00 | Tools in Chat Completions need explicit `reasoning_effort: "none"` (docs) |
| `gpt-6-luna` | chat, reasoning | GA, released 2026-09-22 | $0.09 / $0.45 | Same tool rule as `gpt-6-sol` (docs) |
| `claude-sonnet-5-5` | chat | listed | $1.90 / $9.50 | Thinking cannot be disabled; 5% below official price (docs) |
| `gemini-3.8-flash` | chat | GA 2026-09-02 | $0.68 / $3.38 | Function calling and structured output (docs) |
| `glm-5.3-flash` | chat | listed | $0.11 / $0.37 | Tool calling, 1M ctx, always-on reasoning (docs) |
| `kimi-k3` | chat | listed | $2.85 / $14.25 | (probe) |
| `gpt-5.2` | chat, reasoning | listed | $1.48 / $11.86 | **Our default.** 400K ctx; `reasoning_effort` low to xhigh, no `none` (docs) |
| `doubao-seed-2.0-pro` | chat | listed | $0.47 / $2.35 (prompt <= 32K) | Tiered by prompt length up to 256K (probe) |
| `gemini-2.5-pro` | chat | listed | $1.16 / $9.32 | Price doubles above 200K input (probe) |
| `deepseek-chat` | chat | catalog still lists it; upstream name discontinued 2026-07-24 | CNY 2 / CNY 3 per 1M | Evolink docs still show it; DeepSeek retired the name (docs) |
| `evolink/auto` | router | listed in docs | varies | The real auto-routing ID; `evolink-auto` (our docs) appears nowhere (docs, probe) |
| `claude` | - | not listed | - | Not a model ID in the catalog or docs; Claude IDs are versioned, such as `claude-sonnet-4-6` (probe) |

Model IDs use vendor-style names without an org prefix and with dashes for Anthropic (`claude-sonnet-5-5`) and dots for OpenAI and Google (`gpt-6.1-sol`, `gemini-3.8-flash`) (probe).
The GPT model table on the Chat Completions reference lists `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, the `gpt-5.6` family, `gpt-5.5`, `gpt-5.4`, `gpt-5.2` and `gpt-5.1` (docs).

## API shape

- OpenAI-compatible base URL `https://direct.evolink.ai/v1`; `https://api.evolink.ai` is listed as an alternative server (docs).
  Anthropic-style clients use `https://direct.evolink.ai` (`/v1/messages`), Gemini-style use `/v1beta` (docs).
- Auth: `Authorization: Bearer <EVOLINK_API_KEY>`; Anthropic-style routes also accept `x-api-key` (docs).
- `POST /v1/chat/completions` for chat and client function tools; `POST /v1/responses` for server-side tools and for function tools on `gpt-6.1-sol` and `gpt-6-astra` (docs).
- Sync for chat; SSE streaming available (docs).
- We read `choices[0].message.content`, `tool_calls` and `finish_reason`; the response `model` field is the model actually used (docs).
- Errors: `{"error": {"code", "message", "type"}}`; a missing or bad key returned 401 with `code: "unauthorized"` and `type: "authentication_error"` (probe), and 503 bodies may carry `fallback_suggestion` (docs).
- Model listing: `GET https://direct.evolink.ai/v1/models` with a Bearer key returns IDs with `supported_endpoint_types` (docs).
  Pricing catalog: `GET https://api.evolink.ai/web/api/models/pricing` needs no auth and returns all SKUs in one response (docs, probe).

## Gotchas

- `gpt-6.1-sol` and `gpt-6-astra` reject `reasoning_effort: "none"` and do not do function calling on Chat Completions; our adapter would need the Responses API to use them (docs).
  The model page says a Chat Completions request that includes tools is rejected for `gpt-6.1-sol`, so `vibe agent -p evolink -m gpt-6.1-sol` fails on the first turn (docs).
- The Evolink changelog (September 2026) announces no retirements, including none for `gpt-5.2` or `deepseek-chat` (docs).
- `gpt-6-sol` and `gpt-6-luna` only do function calling on Chat Completions with an explicit `reasoning_effort: "none"`; the default is `medium` (docs).
- `temperature`: omit it for `gpt-6-astra` and `gpt-6.1-sol`, set it on `gpt-6-sol` and `gpt-6-luna` only at effort `none`, and the `gpt-5.6` family accepts only `1` (docs).
  `gpt-5.2` still accepts a custom temperature (docs).
- Prefer `max_completion_tokens`; GPT-6 converts legacy `max_tokens` and drops it if both are sent (docs).
- `deepseek-reasoner` rejects `temperature`, `top_p`, `tools`, `tool_choice` and `response_format` upstream (docs).
- DeepSeek announced on 2026-04-24 that `deepseek-chat` and `deepseek-reasoner` would be discontinued on 2026-07-24, aliased to `deepseek-v4-flash` until then (docs, DeepSeek changelog).
  Evolink's catalog and reference still list `deepseek-chat`; whether it still serves or silently remaps it is unverified.
- Reasoning tokens bill as output tokens on GPT models (docs).
- The catalog mixes units: `fixed_usd` is not on a consistent scale across SKUs, so read `price_range.min_usd` (per 1K for token SKUs) (probe).
- We send OpenRouter-style `HTTP-Referer` and `X-Title` headers; Evolink docs do not mention them, so they are probably ignored.

## In our code

- `packages/cli/src/agent/adapters/evolink.ts:19` - default model `gpt-5.2`.
- `packages/cli/src/agent/adapters/evolink.ts:22-29` - OpenAI SDK client with `baseURL: "https://direct.evolink.ai/v1"` and OpenRouter attribution headers.
- `packages/cli/src/agent/adapters/evolink.ts:90-95` - `chat.completions.create` with `tools` and `tool_choice: "auto"`, no `reasoning_effort`.
- `packages/cli/src/agent/adapters/evolink.ts:106` - unguarded `JSON.parse` of tool arguments.
- `packages/cli/src/agent/adapters/index.ts:59-61` - adapter factory.
- `packages/cli/src/commands/agent.ts:118`, `:387` - key mapping and help text.
- `packages/ai-providers/src/api-keys.ts:144-150`, `:187-189` - key registry entry and virtual provider.
- `packages/cli/src/utils/api-key.ts:19`, `:217` - env mapping and key URL.
- `packages/cli/src/utils/key-live-test.ts:110-117` - live key check against `/v1/models`.
- `packages/cli/src/commands/setup.ts:1224` - setup description.
- `MODELS.md:77-90` - docs table listing `evolink-auto`, `claude` and `deepseek-chat`.

## Recommended changes

1. Fix `MODELS.md`: replace `evolink-auto` with `evolink/auto`, replace bare `claude` with a versioned ID such as `claude-sonnet-5-5`, and drop or flag `deepseek-chat`.
2. Decide on a newer default: `gpt-5.2` is still in the docs model table (not called here), but `gpt-6-luna` or `gpt-6-sol` are newer and cheaper or comparable, provided the adapter sends `reasoning_effort: "none"` when tools are present.
3. If `gpt-6.1-sol` should be selectable, add a Responses API path for tool calls, or reject it with a clear error instead of letting Chat Completions fail.
4. Guard tool-argument `JSON.parse` and empty `choices`, as for OpenRouter (the adapters are copies of each other and could share one OpenAI-compatible base).
5. Drop the OpenRouter-specific attribution headers.
6. Add an `evolink` option to `models_endpoint` in `providers:check` using `/v1/models`, once a key is available to the check.

## Sources

- https://evolink.ai/llms.txt (2026-10-04)
- https://evolink.ai/llms-full.txt (2026-10-04)
- https://evolink.ai/docs/llms.txt (docs.evolink.ai redirects here) (2026-10-04)
- https://evolink.ai/docs/en/api-manual/language-series/gpt/chat-completions/chat-completions-reference.json (2026-10-04)
- https://evolink.ai/docs/en/api-manual/language-series/gpt/responses/responses-reference.json (2026-10-04)
- https://evolink.ai/docs/en/api-manual/language-series/evolink-auto/evolink-auto-quickstart.json (2026-10-04)
- https://evolink.ai/docs/en/api-manual/language-series/deepseek/deepseek-reference.json (2026-10-04)
- https://evolink.ai/gpt-6-1-sol (2026-10-04)
- https://evolink.ai/changelog (2026-10-04)
- https://api-docs.deepseek.com/updates (2026-10-04)
- https://api-docs.deepseek.com/quick_start/pricing (2026-10-04)
- Probe: `GET https://api.evolink.ai/web/api/models/pricing` saved as `evo.json`; `GET https://direct.evolink.ai/v1/models` returned 401 because no `EVOLINK_API_KEY` is set in the repo `.env` (2026-10-04)

