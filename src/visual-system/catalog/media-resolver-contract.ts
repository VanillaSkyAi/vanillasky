import type { TemplateJsonSchema } from "./types.js";

export interface StandardMediaResolverContract {
  acceptsPoster: boolean;
}

/**
 * Resolver output is safe to inject only into templates that declare the SDK's
 * complete standard media contract. A loose stock-media flag is not enough:
 * custom templates may use those fields with different semantics.
 */
export function getStandardMediaResolverContract(
  schema: TemplateJsonSchema,
): StandardMediaResolverContract | undefined {
  const keyword = schema.properties.mediaKeyword;
  const url = schema.properties.mediaUrl;
  const type = schema.properties.mediaType;
  const allowedTypes = new Set(type?.enum ?? []);
  if (
    keyword?.format !== "stock-media-keyword" ||
    url?.format !== "uri" ||
    !["photo", "video"].every((value) => allowedTypes.has(value))
  ) {
    return undefined;
  }
  return {
    acceptsPoster: schema.properties.mediaPoster?.format === "uri",
  };
}
