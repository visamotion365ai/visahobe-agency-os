# Self-hosted browser worker image (Playwright + Chromium, no cloud browser).
FROM mcr.microsoft.com/playwright:v1.49.1-jammy
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_ENV=production
COPY package.json package-lock.json* ./
COPY apps/browser-worker/package.json apps/browser-worker/
RUN npm install --no-audit --no-fund
COPY apps/browser-worker apps/browser-worker
RUN npm run build -w @visahobe/browser-worker
WORKDIR /app/apps/browser-worker
CMD ["node", "dist/index.js"]
