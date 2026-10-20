# syntax=docker/dockerfile:1.7
# Build context: repository root (docker build -f apps/api/Dockerfile .)

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    HUSKY=0
RUN corepack enable
WORKDIR /repo

# ---- Build: lockfile install, TypeScript compilation, production-only bundle.
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @shieldgate/api...
COPY apps/api apps/api
RUN pnpm --filter @shieldgate/api build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @shieldgate/api deploy --prod /out

# ---- Runtime: compiled JavaScript, production dependencies and SQL migrations only.
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health/live || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
