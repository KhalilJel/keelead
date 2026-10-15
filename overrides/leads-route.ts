import { NextRequest, NextResponse } from 'next/server';
import { search, SearchError } from '@/runtime/search-runner.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function execute(input: unknown) {
  try {
    const result = await search(input);
    return NextResponse.json({ ...result, total: result.leads.length, query: (input as { query: string }).query,
      sources: [...new Set(result.leads.map((lead: { source: string }) => lead.source))], timestamp: new Date().toISOString() });
  } catch (error) {
    const known = error instanceof SearchError;
    const status = known ? error.status : 503;
    return NextResponse.json({ error: known ? error.code : 'SEARCH_UNAVAILABLE' }, { status, headers: status === 429 ? { 'Retry-After': '5' } : {} });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 16_384) return NextResponse.json({ error: 'REQUEST_TOO_LARGE' }, { status: 413 });
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > 16_384) return NextResponse.json({ error: 'REQUEST_TOO_LARGE' }, { status: 413 });
        chunks.push(item.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return execute(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }); }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return execute({ query: params.get('q') ?? 'leads', count: params.get('limit') ?? '25', location: params.get('location') ?? undefined, industry: params.get('industry') ?? undefined });
}
