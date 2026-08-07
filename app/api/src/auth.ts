import type { Actor, ActorRole } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  createRemoteJWKSet,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "jose";

import { config } from "./config.js";
import { prisma } from "./db.js";

export interface AuthActor {
  id: string;
  authSubject: string;
  name: string;
  role: ActorRole;
  isSynthetic: boolean;
  defaultLatitude: number | null;
  defaultLongitude: number | null;
  serviceZone: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    actor: AuthActor | null;
  }
}

const localSecret = new TextEncoder().encode(config.devJwtSecret);
const remoteKeys = config.supabaseJwksUrl
  ? createRemoteJWKSet(new URL(config.supabaseJwksUrl))
  : null;

function actorView(actor: Actor, _payload: JWTPayload): AuthActor {
  return {
    id: actor.id,
    authSubject: actor.authSubject,
    name: actor.name,
    role: actor.role,
    isSynthetic: actor.isSynthetic,
    defaultLatitude: actor.defaultLatitude,
    defaultLongitude: actor.defaultLongitude,
    serviceZone: actor.serviceZone,
  };
}

export async function signDevelopmentToken(actor: Actor) {
  return new SignJWT({ role: actor.role, synthetic: actor.isSynthetic })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(actor.authSubject)
    .setIssuer("harvest-local")
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(localSecret);
}

async function verifyToken(token: string) {
  if (remoteKeys) {
    return jwtVerify(token, remoteKeys, {
      issuer: config.supabaseIssuer,
      audience: config.supabaseAudience,
    });
  }
  return jwtVerify(token, localSecret, {
    issuer: "harvest-local",
    audience: "authenticated",
  });
}

export async function registerAuthentication(server: FastifyInstance) {
  server.decorateRequest("actor", null);
  server.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/v1") && !request.url.startsWith("/internal/v1")) {
      return;
    }

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      return reply.code(401).type("application/problem+json").send({
        type: "/problems/authentication",
        title: "Authentication required",
        status: 401,
        code: "AUTHENTICATION_REQUIRED",
        detail: "Send a valid bearer token.",
      });
    }

    if (request.url.startsWith("/internal/v1")) {
      if (authorization.slice(7) !== config.internalServiceToken) {
        return reply.code(401).type("application/problem+json").send({
          type: "/problems/authentication",
          title: "Invalid service token",
          status: 401,
          code: "INVALID_SERVICE_TOKEN",
          detail: "The internal service token is not valid.",
        });
      }
      return;
    }

    try {
      const { payload } = await verifyToken(authorization.slice(7));
      if (!payload.sub) throw new Error("JWT subject is missing");
      const actor = await prisma.actor.findUnique({ where: { authSubject: payload.sub } });
      if (!actor) throw new Error("Actor is not registered");
      request.actor = actorView(actor, payload);
    } catch {
      return reply.code(401).type("application/problem+json").send({
        type: "/problems/authentication",
        title: "Invalid bearer token",
        status: 401,
        code: "INVALID_TOKEN",
        detail: "The bearer token is expired, malformed, or not linked to a Harvest actor.",
      });
    }
  });
}

export function requireRole(request: FastifyRequest, roles: ActorRole[]) {
  if (!request.actor || !roles.includes(request.actor.role)) {
    const error = new Error("The current actor is not allowed to perform this action.");
    Object.assign(error, { statusCode: 403, code: "ROLE_FORBIDDEN" });
    throw error;
  }
  return request.actor;
}
