# Sentire Cloud: one image. ROLE=all (default) runs web and jobs; ROLE=web or ROLE=worker split them.
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build && rm -rf .next/cache

FROM node:22-alpine AS run
WORKDIR /app
RUN apk add --no-cache chromium font-noto
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 CHROME_PATH=/usr/bin/chromium-browser
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/.next ./.next
COPY --chown=node:node --from=build /app/public ./public
COPY --chown=node:node --from=build /app/drizzle ./drizzle
COPY --chown=node:node --from=build /app/src ./src
COPY --chown=node:node --from=build /app/server.ts /app/package.json /app/tsconfig.json /app/next.config.ts ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["sh", "-c", "if [ \"$ROLE\" = worker ]; then exec node_modules/.bin/tsx src/worker/index.ts; else exec node_modules/.bin/tsx server.ts; fi"]
