import createClient from "openapi-fetch";

import type { components, paths } from "./generated/product-api";

export type ProductApiPaths = paths;
export type ProductApiSchemas = components["schemas"];
export type ApiSchema<Name extends keyof ProductApiSchemas> = ProductApiSchemas[Name];
export type { HarvestDomainEventEnvelope } from "./generated/event-envelope";
export {
  ACTION_PREVIEW_MESSAGE,
  ACTION_PREVIEW_READY,
  isActionPreviewMessage,
  isActionPreviewReadyMessage,
  type ActionPreviewMessage,
  type ActionPreviewReadyMessage,
  type ActionPreviewRole,
  type ActionPreviewStatus,
} from "./action-preview";

export interface HarvestClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null | Promise<string | null>;
}

export function createHarvestClient({ baseUrl, getAccessToken }: HarvestClientOptions) {
  return createClient<paths>({
    baseUrl,
    async fetch(request) {
      const headers = new Headers(request.headers);
      const token = await getAccessToken?.();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return fetch(new Request(request, { headers }));
    },
  });
}

export function newIdempotencyKey(prefix = "web") {
  return `${prefix}-${crypto.randomUUID()}`;
}
