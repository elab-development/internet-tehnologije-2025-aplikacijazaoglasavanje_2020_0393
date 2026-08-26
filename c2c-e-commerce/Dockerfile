# ── Stage 1: install dependencies ──────────────────────────────────────────────
FROM node:20-slim AS deps
# onnxruntime-node (via @huggingface/transformers) ships prebuilt binaries linked
# against glibc, so these stages are Debian slim rather than Alpine. On Alpine the
# model prefetch fails at build time with ERR_DLOPEN_FAILED against musl.
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# ── Stage 1b: production-only dependencies ─────────────────────────────────────
# The runner used to copy the full dependency tree, devDependencies included. That was
# merely wasteful until C2C-AI-2 added onnxruntime, at which point the image reached
# 2.73 GB. Risk R2's mitigation calls for measuring image size in that story, so the
# trimming lands with it.
FROM node:20-slim AS prod-deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# onnxruntime-node ships prebuilt binaries for every platform it supports. In a Linux
# image the Windows and macOS ones are 159 MB of dead weight, and onnxruntime-web is the
# browser build, which nothing here loads.
RUN rm -rf node_modules/onnxruntime-node/bin/napi-v6/win32            node_modules/onnxruntime-node/bin/napi-v6/darwin            node_modules/onnxruntime-web

# ── Stage 2: build ──────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env vars (non-secret). Runtime secrets are supplied via compose.
ENV NEXT_TELEMETRY_DISABLED=1

# Bake the embedding model into the image (C2C-AI-2 AC7). Doing this at build time is
# what lets a container with no network still answer a semantic query; it also fails the
# build, rather than a user's request, if the ONNX runtime cannot start in this image.
ENV TRANSFORMERS_CACHE=/app/.cache/transformers
RUN node scripts/prefetch-embedding-model.mjs

RUN npm run build

# ── Stage 3: migrator ───────────────────────────────────────────────────────────
FROM node:20-slim AS migrator
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY . .

CMD ["npm", "run", "db:migrate"]

# ── Stage 4: production runner ──────────────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy the standalone server output produced by `output: 'standalone'`
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static    ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public          ./public

# Copy migration script and SQL files (used by railway.toml preDeployCommand)
COPY --from=builder --chown=nextjs:nodejs /app/scripts         ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/drizzle         ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/src/db/migrate.ts ./src/db/migrate.ts

# Production dependencies only, so migrate.ts (via tsx) can still resolve drizzle-orm
# and pg without dragging typescript, drizzle-kit and babel into the runtime image.
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules  ./node_modules

# The baked embedding model. Transformers.js defaults its cache to a directory inside
# node_modules, which this multi-stage build discards, so the path is explicit on both
# sides and TRANSFORMERS_CACHE points the runtime at it.
COPY --from=builder --chown=nextjs:nodejs /app/.cache/transformers ./.cache/transformers
ENV TRANSFORMERS_CACHE=/app/.cache/transformers

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
