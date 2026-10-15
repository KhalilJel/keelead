FROM node:20-alpine AS builder
RUN apk add --no-cache git openssl
WORKDIR /src
# Pin the audited upstream source; an upstream push cannot change this image.
RUN git init && git remote add origin https://github.com/Atum246/keelead.git && git fetch --depth 1 origin a846e2b6c19f781d44073f2e651c1ac8de52cf4a && git checkout --detach FETCH_HEAD
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
RUN npx prisma generate
RUN sed -i "s/el\.textContent() || ''/el.textContent().then((text) => text ?? '')/" lib/browser/index.ts
RUN sed -i 's/out center body;`);/out center body;`/' lib/sources/local/openstreetmap.ts
RUN sed -i 's/return this.searchWithGeo({ \.\.\.parsed, location: query }, fallback, options)/return this.searchWithGeo({ ...parsed, location: query }, fallback)/' lib/sources/local/openstreetmap.ts
RUN sed -i 's/return this.searchWithGeo(parsed, geoResult, options)/return this.searchWithGeo(parsed, geoResult)/' lib/sources/local/openstreetmap.ts
RUN sed -i 's/private async searchWithGeo(\n    parsed: ParsedQuery,\n    geo: NominatimResult\n  )/private async searchWithGeo(\n    parsed: ParsedQuery,\n    geo: NominatimResult,\n    options?: SearchOptions\n  )/' lib/sources/local/openstreetmap.ts
RUN sed -i 's/const count = options?\\.count || leads\\.length/const count = leads.length/' lib/sources/local/openstreetmap.ts
RUN sed -i 's/const count = options?\.count || leads\.length/const count = leads.length/' lib/sources/local/openstreetmap.ts
COPY runtime ./runtime
COPY overrides/leads-route.ts ./app/api/leads/route.ts
RUN npm run build

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /src/package.json ./package.json
COPY --from=builder /src/node_modules ./node_modules
COPY --from=builder /src/.next ./.next
COPY --from=builder /src/public ./public
COPY --from=builder /src/prisma ./prisma
COPY --from=builder /src/next.config.js ./next.config.js
COPY --from=builder /src/runtime ./runtime
COPY --from=builder /src/lib ./lib
COPY --from=builder /src/tsconfig.json ./tsconfig.json
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app
USER nextjs
EXPOSE 3000
# Schema changes are separate, explicit operations; never mutate data on startup.
CMD ["npm", "run", "start"]
