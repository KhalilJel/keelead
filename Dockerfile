FROM node:20-alpine AS builder
RUN apk add --no-cache git openssl
WORKDIR /src

RUN git clone --depth 1 https://github.com/Atum246/keelead.git .

RUN npm install next@15.5.27 --save-exact --no-audit --no-fund
RUN npm install --no-audit --no-fund
RUN npx prisma generate
RUN sed -i "s/el\.textContent() || ''/el.textContent().then((text) => text ?? '')/" lib/browser/index.ts
RUN sed -i 's/out center body;`);/out center body;`/' lib/sources/local/openstreetmap.ts
RUN sed -i 's/return this.searchWithGeo({ \.\.\.parsed, location: query }, fallback, options)/return this.searchWithGeo({ ...parsed, location: query }, fallback)/' lib/sources/local/openstreetmap.ts
RUN sed -i 's/return this.searchWithGeo(parsed, geoResult, options)/return this.searchWithGeo(parsed, geoResult)/' lib/sources/local/openstreetmap.ts
RUN sed -i 's/private async searchWithGeo(\n    parsed: ParsedQuery,\n    geo: NominatimResult\n  )/private async searchWithGeo(\n    parsed: ParsedQuery,\n    geo: NominatimResult,\n    options?: SearchOptions\n  )/' lib/sources/local/openstreetmap.ts
RUN sed -i 's/const count = options?\\.count || leads\\.length/const count = leads.length/' lib/sources/local/openstreetmap.ts
RUN sed -i 's/const count = options?\.count || leads\.length/const count = leads.length/' lib/sources/local/openstreetmap.ts
RUN cat > app/api/leads/route.ts <<'EOF'
import { NextRequest, NextResponse } from "next/server"
import { sourceManager } from "@/lib/sources"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const query = body.query || "Find leads"
    const leads = await sourceManager.searchAll(query, { count: body.count ? Number(body.count) : undefined, location: body.location, industry: body.industry })
    return NextResponse.json({ leads, total: leads.length, sources: [...new Set(leads.map((lead) => lead.source))], query, timestamp: new Date() })
  } catch (error) {
    console.error("KeeLead source search failed", error)
    return NextResponse.json({ error: "Failed to search leads" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get("q") || "leads"
    const count = Number(searchParams.get("limit") || "25")
    const leads = await sourceManager.searchAll(query, { count })
    return NextResponse.json({ leads, total: leads.length, sources: [...new Set(leads.map((lead) => lead.source))], query, timestamp: new Date() })
  } catch (error) {
    console.error("KeeLead source search failed", error)
    return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 })
  }
}
EOF
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

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push --accept-data-loss && npm run start"]
