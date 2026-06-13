import { betterAuth } from "better-auth";
import { pool } from "./db";

const frontendUrl = process.env.VITE_FRONTEND_URL ?? "http://localhost:3300";

// Discord OAuth is optional in dev — only register the provider when creds are
// present so the app still boots without them.
const discordConfigured =
  !!process.env.DISCORD_CLIENT_ID && !!process.env.DISCORD_CLIENT_SECRET;

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

  socialProviders: discordConfigured
    ? {
        discord: {
          clientId: process.env.DISCORD_CLIENT_ID as string,
          clientSecret: process.env.DISCORD_CLIENT_SECRET as string,
          // Discord verifies emails before exposing them, so it's safe to
          // trust for auto-linking (see accountLinking below).
        },
      }
    : {},

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
    // Auto-link a Discord login to an existing account with the same email.
    // Only safe because Discord verifies emails before exposing them — never
    // trust a provider that doesn't (silent account takeover). Untrusted
    // providers fall back to better-auth's default: refuse + surface an error.
    accountLinking: {
      enabled: true,
      trustedProviders: ["discord"],
      // This app does no email verification (no mail is sent), so every
      // password account has email_verified = false. better-auth's default
      // refuses to link a social login to an unverified local account — which
      // would make Discord linking ALWAYS fail here. Turn that guard off; we
      // accept the residual pre-registration-link risk (private friend group).
      requireLocalEmailVerified: false,
    },
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
