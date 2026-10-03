---
provider: ollama
checked: 2026-10-04
env: []
models_endpoint: none
models_in_use:
  - llama3.2
---

# Ollama

Ollama runs open-weight models on the user's machine behind a local HTTP server, with no API key and no per-token cost.
VibeFrame uses it as a free, offline LLM backend for `vibe agent -p ollama` and for natural-language timeline commands in `OllamaProvider`, both defaulting to `llama3.2`.

## Models

There is no hosted catalog to probe; models are whatever the user has pulled (`GET /api/tags` lists them).
Tool calling depends on the model, and the Ollama library marks capable models with a `tools` tag (docs).

| ID | Kind | Status | Price | Notes |
|---|---|---|---|---|
| `llama3.2` | chat, local | available, last updated about 2 years ago | free (local) | **Our default.** Tagged `tools`; default tag is the 3B model, 1B also exists; 128K max context (docs) |
| `qwen3` | chat, local | available | free (local) | The model Ollama's own tool-calling docs use in examples (docs) |
| `mistral`, `phi`, `tinyllama` | chat, local | available | free (local) | Named only in a code comment as lighter alternatives; tool support not checked |

## API shape

- Default server `http://localhost:11434`; the server binds `127.0.0.1:11434` unless `OLLAMA_HOST` (`address:port`) says otherwise (docs).
- No auth on the native API.
  The OpenAI-compatible API at `http://localhost:11434/v1/` needs an API key value but ignores it (docs).
- Native chat: `POST /api/chat` with `model`, `messages`, optional `tools`, `format` (`"json"` or a JSON schema), `stream` (default `true`), `think`, `keep_alive` and `options` such as `temperature` and `num_ctx` (docs).
- Response: `message.content`, `message.tool_calls`, `message.thinking`, `done`, `done_reason` (docs).
- Native tool calls return `arguments` as an object, not a JSON string; results go back as `role: "tool"` messages with `tool_name` (docs).
- The OpenAI-compatible layer supports `/v1/chat/completions` with `tools`, `/v1/models`, `/v1/embeddings` and a stateless `/v1/responses` (docs).
  It does not support `tool_choice` or `logprobs`, and images must be base64, not URLs (docs).
- Errors from `/api/chat` come back as non-2xx with a JSON `error` string, or as a body with `error` (we check both in `OllamaProvider`).

## Gotchas

- `stream` defaults to `true` on `/api/chat`; both of our callers correctly send `stream: false` (docs).
- Default context window is 4096 tokens unless `OLLAMA_CONTEXT_LENGTH` or a per-request `options.num_ctx` raises it (docs).
  The agent registry has 93 tools whose names, descriptions and parameter docs alone are roughly 48K characters, about 12K tokens (probe, local count via tsx).
  Our Ollama adapter puts all of that into the system prompt, so at the default context the prompt is truncated before the user message is even considered.
- The OpenAI-compatible layer has no way to set context size; it needs a Modelfile with `PARAMETER num_ctx` (docs).
- Models unload after 5 minutes idle by default (`keep_alive`), so the first agent turn after a pause pays the load time again (docs).
- Ollama has native tool calling, but our adapter does not use it; it asks the model to emit a fenced JSON `{"tool_calls": [...]}` block and regex-parses it.
  Small models often wrap, reformat or partially emit that JSON.
  The unfenced fallback regex ends at the first `]}`, so arguments that contain an array (for example `{"paths": ["a"]}`) are cut short and fail to parse.
- `OLLAMA_HOST` uses `address:port` without a scheme (docs), but our template suggests `http://localhost:11434`, and no code reads the variable.
- No code outside the two chat calls touches port 11434 (no doctor or reachability check), so a stopped server only surfaces as a fetch error on the first chat.

## In our code

- `packages/cli/src/agent/adapters/ollama.ts:27-28` - default base URL `http://localhost:11434` and model `llama3.2`.
- `packages/cli/src/agent/adapters/ollama.ts:31-37` - `initialize(apiKey)` treats an `http...` "key" as the base URL.
- `packages/cli/src/agent/adapters/ollama.ts:63-91` - tool definitions rendered as prose into the system prompt.
- `packages/cli/src/agent/adapters/ollama.ts:102-129` - tool results replayed as `user` messages instead of `role: "tool"`.
- `packages/cli/src/agent/adapters/ollama.ts:132-142` - `POST /api/chat` with `stream: false`, no `tools`, no `options`.
- `packages/cli/src/agent/adapters/ollama.ts:171-215` - regex-based tool-call extraction.
- `packages/cli/src/commands/agent.ts:115`, `:121-129` - Ollama skips key lookup and hardcodes `http://localhost:11434`.
- `packages/ai-providers/src/ollama/OllamaProvider.ts:22-23` - default base URL and `llama3.2`, with alternatives in a comment.
- `packages/ai-providers/src/ollama/OllamaProvider.ts:107-122` - `POST /api/chat` with `format: "json"`; the comment above calls it the OpenAI-compatible endpoint, but it is the native API.
- `packages/ai-providers/src/ollama/OllamaProvider.ts:124-155` - falls back to keyword parsing on any error.
- `packages/ai-providers/src/ollama/index.ts:6-11` - provider registration with `apiKey: null`.
- `packages/cli/src/commands/setup.ts:1225` - setup text naming the `llama3.2` default.
- `packages/cli/src/commands/_shared/init-templates.ts:385` - `.env` template suggests an `OLLAMA_HOST` that nothing reads.

## Recommended changes

1. Switch the agent adapter to native tool calling: send `tools` on `/api/chat`, read `message.tool_calls` (object arguments), and send results as `role: "tool"` with `tool_name`.
   Keep the JSON-in-prompt path only as a fallback for models without the `tools` tag.
2. Send `options.num_ctx` large enough for the tool list (at least 16K), or trim the tool set for local models; otherwise the default 4096 silently truncates.
3. Read `OLLAMA_HOST` (adding `http://` when no scheme is given) in `agent.ts` and `OllamaProvider`, or remove it from the init template.
4. Consider a stronger tool-calling default than `llama3.2` 3B, for example a current `qwen3` tag; verify on a real run before changing.
5. Add a cheap reachability check (`GET /api/version` or `/api/tags`) to `vibe doctor` and before the first agent turn, with an install or `ollama serve` hint.
6. Fix the misleading "OpenAI-compatible" comment in `OllamaProvider.ts`.

## Sources

- https://docs.ollama.com/api/chat (2026-10-04)
- https://docs.ollama.com/capabilities/tool-calling (2026-10-04)
- https://docs.ollama.com/api/openai-compatibility (2026-10-04)
- https://docs.ollama.com/faq (2026-10-04)
- https://ollama.com/library/llama3.2 (2026-10-04)
- Probe: `GET http://localhost:11434/api/version` got no answer (Ollama is not installed on this machine), so no model behavior was observed; tool prompt size counted from `registerAllTools` via tsx (2026-10-04)
