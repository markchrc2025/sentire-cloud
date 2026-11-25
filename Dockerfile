# Sentire Cloud: one image. ROLE=all (default) runs web and jobs; ROLE=web or ROLE=worker split them.
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-alpine AS run
WORKDIR /app
RUN apk add --no-cache chromium font-noto && corepack enable
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 CHROME_PATH=/usr/bin/chromium-browser
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["sh", "-c", "if [ \"$ROLE\" = worker ]; then exec node_modules/.bin/tsx src/worker/index.ts; else exec node_modules/.bin/tsx server.ts; fi"]
