# ── Stage 1: install dependencies ──────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# ── Stage 2: build ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env vars (non-secret). Runtime secrets are supplied via compose.
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Stage 3: migrator ───────────────────────────────────────────────────────────
FROM node:20-alpine AS migrator
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

CMD ["npm", "run", "db:migrate"]

# ── Stage 4: production runner ──────────────────────────────────────────────────
FROM node:20-alpine AS runner
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

# Copy full node_modules so migrate.mjs can resolve drizzle-orm and pg
COPY --from=deps --chown=nextjs:nodejs /app/node_modules       ./node_modules

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
