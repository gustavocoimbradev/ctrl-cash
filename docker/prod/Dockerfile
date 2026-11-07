# Production image: builds the web app (Expo static export) and serves it with Caddy.
# The Firebase web config is public by design (see README), so nothing secret goes into the image.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# The public address replaces the placeholder domain in the SEO files (canonical, sitemap, llms.txt...)
ARG SITE_URL
ENV SITE_URL=${SITE_URL} CI=1
RUN npx expo export --platform web && node scripts/seo-postbuild.mjs

FROM caddy:2-alpine
COPY docker/prod/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
