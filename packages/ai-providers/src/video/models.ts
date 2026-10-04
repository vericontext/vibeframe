import { assertModelServed, findModel, listModels, type ModelSpec } from "../catalog/catalog.js";
import { ProviderError } from "../shared/errors.js";

/**
 * The catalog video model a request names (alias or ID; the provider's
 * default when omitted). Throws `invalid-request` for an unknown model and
 * `model-retired` for one past its shutdown date, before any request.
 */
export function resolveVideoModel(provider: string, model?: string): ModelSpec {
  const spec = findModel(provider, "video", model);
  if (!spec) {
    const valid = listModels({ provider, kind: "video" })
      .flatMap((m) => [m.id, ...(m.aliases ?? [])])
      .join(", ");
    throw new ProviderError({
      kind: "invalid-request",
      provider,
      message: `Unknown ${provider} video model "${model}". Valid: ${valid}.`,
    });
  }
  assertModelServed(spec);
  return spec;
}
