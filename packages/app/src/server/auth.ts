import { betterAuth } from "better-auth";
import { pool } from "./db";

const frontendUrl = process.env.VITE_FRONTEND_URL ?? "http://localhost:3300";

export const auth = betterAuth({
  // Needed for server-side `auth.api.*` calls that build absolute URLs
  // without an incoming request. Inbound requests work as before.
  baseURL: frontendUrl,
  trustedOrigins: [frontendUrl],
  telemetry: {
    enabled: false,
  },
  database: pool,
  secret: process.env.AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },

  // Models — map better-auth's camelCase fields onto our snake_case columns
  // (see the auth tables migration).
  user: {
    modelName: "users",
    fields: {
      createdAt: "created_at",
      updatedAt: "updated_at",
      emailVerified: "email_verified",
      email: "email",
      name: "name",
      image: "image",
    },
  },
  session: {
    modelName: "sessions",
    fields: {
      createdAt: "created_at",
      updatedAt: "updated_at",
      expiresAt: "expires_at",
      ipAddress: "ip_address",
      token: "token",
      userAgent: "user_agent",
      userId: "user_id",
    },
  },
  account: {
    modelName: "accounts",
    fields: {
      createdAt: "created_at",
      updatedAt: "updated_at",
      accessToken: "access_token",
      accessTokenExpiresAt: "access_token_expires_at",
      accountId: "account_id",
      providerId: "provider_id",
      idToken: "id_token",
      password: "password",
      refreshToken: "refresh_token",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      scope: "scope",
      userId: "user_id",
    },
  },
  verification: {
    modelName: "verifications",
    fields: {
      createdAt: "created_at",
      updatedAt: "updated_at",
      identifier: "identifier",
      value: "value",
      expiresAt: "expires_at",
    },
  },
});
