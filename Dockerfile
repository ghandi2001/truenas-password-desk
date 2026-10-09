FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json scripts/import-build-cache.cjs ./
COPY .build-cache /tmp/build-cache
RUN node import-build-cache.cjs /tmp/build-cache && rm -rf /tmp/build-cache import-build-cache.cjs \
 && npm ci --offline --ignore-scripts --no-audit --no-fund \
 && npm rebuild --foreground-scripts
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM build AS tools
ENV NODE_ENV=production
USER node
CMD ["npx", "prisma", "migrate", "deploy"]
