export const config = {
  port: Number(process.env.PRODUCT_API_PORT ?? 3001),
  host: process.env.PRODUCT_API_HOST ?? "0.0.0.0",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://harvest:harvest-local-only@localhost:5432/harvest?schema=public",
  websiteOrigin: process.env.WEBSITE_ORIGIN ?? "http://localhost:3000",
  devJwtSecret:
    process.env.DEV_JWT_SECRET ?? "harvest-local-development-secret-change-me",
  supabaseJwksUrl: process.env.SUPABASE_JWKS_URL,
  supabaseIssuer: process.env.SUPABASE_JWT_ISSUER,
  supabaseAudience: process.env.SUPABASE_JWT_AUDIENCE ?? "authenticated",
  internalServiceToken:
    process.env.INTERNAL_SERVICE_TOKEN ?? "harvest-local-service-token-change-me",
  enableDevAuth: process.env.ENABLE_DEV_AUTH !== "false" && process.env.NODE_ENV !== "production",
  modelAdapter: process.env.MODEL_ADAPTER ?? "fixture",
};
