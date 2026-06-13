# --- Prune the monorepo to just @this/app + its deps ---
FROM node:24-alpine AS base
WORKDIR /app

COPY . .
RUN npm i -g turbo && npx turbo prune --scope=@this/app --docker

# --- Install + build ---
FROM node:24-alpine AS builder
WORKDIR /app

# Install dependencies from the pruned lockfile/package.jsons first (cached).
COPY --from=base /app/out/json/ .
RUN npm ci

# Source for the in-scope workspace.
COPY --from=base /app/out/full/ .

# The frontend URL is baked into the client bundle at build time, so it must
# be passed as a build arg. The app's build script reads packages/.env via
# dotenv-cli, so materialize it here from the arg.
ARG VITE_FRONTEND_URL=http://localhost:3300
ENV VITE_FRONTEND_URL=${VITE_FRONTEND_URL}
RUN printf 'VITE_FRONTEND_URL=%s\n' "$VITE_FRONTEND_URL" > packages/.env

RUN npx turbo run build --filter=@this/app

WORKDIR /app/packages/app

# Nitro server listens on $PORT (default 3000).
ENV PORT=3000
EXPOSE 3000

CMD ["sh", "./entrypoint.sh"]
