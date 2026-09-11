import { betterAuth } from "better-auth";
import { mcp } from "better-auth/plugins";
import { pool } from "./db";

const frontendUrl = process.env.VITE_FRONTEND_URL ?? "http://localhost:3300";

// Discord OAuth is optional in dev — only register the provider when creds are
// present so the app still boots without them.
const discordConfigured =
  !!process.env.DISCORD_CLIENT_ID && !!process.env.DISCORD_CLIENT_SECRET;

// Where the OAuth authorize endpoint sends a logged-out user (see the mcp
// plugin below); the page continues the flow after sign-in.
const OAUTH_LOGIN_PAGE = "/auth/login";

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

  plugins: [
    // OAuth 2.1 authorization server for MCP clients that cannot send an API
    // key — claude.ai custom connectors and Claude Code's `/mcp` login. A
    // logged-out user is sent to OUR login page with the authorize query
    // attached; the page continues the flow after sign-in (lib/oauthLogin.ts).
    // Whoever signs in is the user the OAuth client acts as. No consent
    // screen: for this friend group, logging in IS the consent.
    mcp({
      loginPage: OAUTH_LOGIN_PAGE,
      // RFC 9728 resource identifier = the protected endpoint itself.
      resource: `${frontendUrl}/api/mcp`,
      oidcConfig: {
        // `mcp()` overwrites this with the option above at runtime, but the
        // underlying OIDCOptions type marks it required — pass the same const.
        loginPage: OAUTH_LOGIN_PAGE,
        // Long-lived on purpose: a connector that silently stops working after
        // an hour is worse than a token that lives about as long as a session
        // (API keys never expire at all).
        accessTokenExpiresIn: 60 * 60 * 24 * 30,
        refreshTokenExpiresIn: 60 * 60 * 24 * 90,
        // snake_case columns, like every other better-auth table (see the
        // `user`/`session`/`account` maps below and migration …013).
        schema: {
          oauthApplication: {
            modelName: "oauth_applications",
            fields: {
              clientId: "client_id",
              clientSecret: "client_secret",
              redirectUrls: "redirect_urls",
              userId: "user_id",
              createdAt: "created_at",
              updatedAt: "updated_at",
            },
          },
          oauthAccessToken: {
            modelName: "oauth_access_tokens",
            fields: {
              accessToken: "access_token",
              refreshToken: "refresh_token",
              accessTokenExpiresAt: "access_token_expires_at",
              refreshTokenExpiresAt: "refresh_token_expires_at",
              clientId: "client_id",
              userId: "user_id",
              createdAt: "created_at",
              updatedAt: "updated_at",
            },
          },
          oauthConsent: {
            modelName: "oauth_consents",
            fields: {
              clientId: "client_id",
              userId: "user_id",
              consentGiven: "consent_given",
              createdAt: "created_at",
              updatedAt: "updated_at",
            },
          },
        },
      },
    }),
  ],

  socialProviders: discordConfigured
    ? {
        discord: {
          clientId: process.env.DISCORD_CLIENT_ID as string,
          clientSecret: process.env.DISCORD_CLIENT_SECRET as string,
          // Discord verifies emails before exposing them, so it's safe to
          // trust for auto-linking (see accountLinking below).
          //
          // Mirror the Discord identity (display name + avatar + email) onto
          // the user on EVERY Discord login — this is a Discord friend-group
          // app, so the Discord profile is the source of truth. Without this,
          // linking only attaches tokens and never copies the avatar, so a
          // pre-existing account keeps its old (blank) image. Note: this
          // overwrites any custom in-app name with the Discord one each login.
          overrideUserInfoOnSignIn: true,
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
