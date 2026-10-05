import { assertModelServed, findModel, listModels, type ModelKind, type ModelSpec } from "../catalog/catalog.js";
import { ProviderError } from "../shared/errors.js";

/**
 * The catalog model a request names (alias or ID; the provider's default
 * when omitted). Throws `invalid-request` for an unknown model and
 * `model-retired` for one past its shutdown date, before any request.
 */
export function resolveCatalogModel(provider: string, kind: ModelKind, model?: string): ModelSpec {
  const spec = findModel(provider, kind, model);
  if (!spec) {
    const valid = listModels({ provider, kind })
      .filter((m) => m.status !== "deprecated" || !m.shutdown || Date.parse(`${m.shutdown}T00:00:00Z`) > Date.now())
      .flatMap((m) => [...(m.aliases ?? []), m.id])
      .join(", ");
    throw new ProviderError({
      kind: "invalid-request",
      provider,
      message: `Unknown ${provider} ${kind} model "${model}". Valid: ${valid}.`,
    });
  }
  assertModelServed(spec);
  return spec;
}

/** `resolveCatalogModel` for video. */
export function resolveVideoModel(provider: string, model?: string): ModelSpec {
  return resolveCatalogModel(provider, "video", model);
}
