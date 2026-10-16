# API server image.
# The Playwright base image is used because PDF rendering uses the locally
# installed Chromium (no external service, no extra licence cost).
FROM mcr.microsoft.com/playwright:v1.49.1-jammy AS base
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

FROM base AS deps
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/browser-worker/package.json apps/browser-worker/
COPY apps/web/package.json apps/web/
RUN npm install --no-audit --no-fund

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build -w @visahobe/shared && npm run build -w @visahobe/server

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY package.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
WORKDIR /app/apps/server
EXPOSE 8787
CMD ["node", "dist/index.js"]
