try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}

export const config = {
  port: Number(process.env.PORT ?? process.env.PRODUCT_API_PORT ?? 3001),
  host: process.env.PRODUCT_API_HOST ?? "0.0.0.0",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://harvest:harvest-local-only@localhost:5432/harvest?schema=public",
  websiteOrigin: process.env.WEBSITE_ORIGIN ?? "http://localhost:3000",
  controlRoomOrigin: process.env.CONTROL_ROOM_ORIGIN ?? "http://localhost:3002",
  // Comma-separated list of additional allowed CORS origins (e.g. a preview
  // deployment URL). Optional; never a wildcard.
  extraOrigins: (process.env.EXTRA_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  devJwtSecret:
    process.env.DEV_JWT_SECRET ?? "harvest-local-development-secret-change-me",
  supabaseJwksUrl: process.env.SUPABASE_JWKS_URL,
  supabaseIssuer: process.env.SUPABASE_JWT_ISSUER,
  supabaseAudience: process.env.SUPABASE_JWT_AUDIENCE ?? "authenticated",
  internalServiceToken:
    process.env.INTERNAL_SERVICE_TOKEN ?? "harvest-local-service-token-change-me",
  // Demo personas (dev-session sign-in, the control room's operations
  // session) are enabled below production by default. Setting
  // HARVEST_DEMO_PERSONAS=true opts a production deployment into them for a
  // public, synthetic-data-only demo. Default is off and unchanged.
  enableDevAuth:
    process.env.ENABLE_DEV_AUTH !== "false" &&
    (process.env.NODE_ENV !== "production" || process.env.HARVEST_DEMO_PERSONAS === "true"),
  modelAdapter: process.env.MODEL_ADAPTER ?? "fixture",
  modelServiceUrl: process.env.MODEL_SERVICE_URL?.trim() ?? "http://localhost:8002",
  agentLlmProvider: process.env.AGENT_LLM_PROVIDER?.trim() ?? "",
  agentLlmModel: process.env.AGENT_LLM_MODEL?.trim() ?? "",
  agentLlmBaseUrl: process.env.AGENT_LLM_BASE_URL?.trim() ?? "",
  agentLlmApiKey: process.env.AGENT_LLM_API_KEY?.trim() ?? "",
};
