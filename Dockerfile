FROM node:20-alpine AS builder
RUN apk add --no-cache git
WORKDIR /src

RUN git clone --depth 1 https://github.com/Atum246/keelead.git .

RUN npm install next@15.5.27 --save-exact --no-audit --no-fund
RUN npm install --no-audit --no-fund
RUN npx prisma generate
RUN sed -i "s/el\.textContent() || ''/el.textContent().then((text) => text ?? '')/" lib/browser/index.ts
RUN sed -i 's/out center body;`);/out center body;`/' lib/sources/local/openstreetmap.ts
RUN sed -i 's/return this.searchWithGeo({ \.\.\.parsed, location: query }, fallback, options)/return this.searchWithGeo({ ...parsed, location: query }, fallback)/' lib/sources/local/openstreetmap.ts
RUN sed -i 's/return this.searchWithGeo(parsed, geoResult)/return this.searchWithGeo(parsed, geoResult, options)/' lib/sources/local/openstreetmap.ts
RUN sed -i 's/private async searchWithGeo(\n    parsed: ParsedQuery,\n    geo: NominatimResult\n  )/private async searchWithGeo(\n    parsed: ParsedQuery,\n    geo: NominatimResult,\n    options?: SearchOptions\n  )/' lib/sources/local/openstreetmap.ts
RUN npm run build

FROM node:20-alpine AS runner
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

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push --accept-data-loss && npm run start"]

RUN sed -i 's/const count = options?\.count || leads\.length/const count = leads.length/' lib/sources/local/openstreetmap.ts