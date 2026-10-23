# Node 25+ no longer bundles corepack, so install it once for the stages that run pnpm.
FROM node:26-bookworm-slim AS node
RUN npm install -g corepack && corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# The web app.
FROM node AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
# The build validates the env vars (see src/env.ts) but doesn't inline them: placeholders are enough.
RUN ORIGIN=http://localhost BETTER_AUTH_SECRET=build-placeholder pnpm build

# Development: `vite dev` with the source bind-mounted (see docker-compose.dev.yaml).
FROM node AS dev
WORKDIR /app
CMD ["sh", "-c", "pnpm install && pnpm dev"]

FROM node:26-bookworm-slim
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle

ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	DATA_DIR=/data
VOLUME /data
EXPOSE 3000

CMD ["node", "build"]
