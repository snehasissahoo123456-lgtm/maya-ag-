# syntax=docker/dockerfile:1
FROM oven/bun:1.4.4 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build
RUN bun -e 'import { createHash } from "node:crypto"; import { readFileSync, writeFileSync } from "node:fs"; const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex"); writeFileSync(".maya-dependency-manifest.json", JSON.stringify({ version: 1, packageJsonSha256: hash("package.json"), bunLockSha256: hash("bun.lock") }));'

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV MAYA_DATA_DIR=/data
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.maya-dependency-manifest.json ./.maya-dependency-manifest.json
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json
# Keep the source workspace available for read-only scheduled analysis tools.
# .dockerignore excludes local secrets, data, node_modules and build output.
COPY --chown=node:node . .

RUN mkdir -p /data /developer-queue /developer-workspaces && chown node:node /data /developer-queue /developer-workspaces
USER node

EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.cjs"]
