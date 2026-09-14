# Build Stage
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

# Copy root and package manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY prisma ./prisma/
COPY apps/api/package.json ./apps/api/

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source code
COPY apps/api ./apps/api/

# Generate Prisma Client & Build API
RUN pnpm prisma:generate
RUN pnpm --filter @puntual/api build

# Production Runner Stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

COPY package.json pnpm-workspace.yaml ./
COPY prisma ./prisma/
COPY apps/api/package.json ./apps/api/

# Install production dependencies only
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Security: non-root user
USER node

EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]
