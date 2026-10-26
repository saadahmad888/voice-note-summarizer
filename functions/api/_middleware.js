// CORS for the Android app + consistent JSON errors for every /api/* route.
const isAllowed = (origin, host) => {
  if (!origin) return true; // same-origin GET / server-to-server
  try {
    const u = new URL(origin);
    if (u.host === host) return true;                                   // your own site / custom domain
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true; // the APK (https://localhost) and local dev
    if (u.protocol === 'capacitor:') return true;
    if (u.hostname.endsWith('.pages.dev') && host.endsWith('.pages.dev') &&
        u.hostname.split('.').slice(-3).join('.') === host.split('.').slice(-3).join('.')) return true; // preview deployments
  } catch {}
  return false;
};

export async function onRequest(ctx) {
  const { request, env } = ctx;
  const origin = request.headers.get('Origin');
  const host = new URL(request.url).host;
  const allowed = isAllowed(origin, host);
  const cors = {
    'Access-Control-Allow-Origin': allowed && origin ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
  if (!allowed) return Response.json({ error: 'This origin is not allowed.' }, { status: 403, headers: cors });
  if (!env.AI) {
    return Response.json({ error: 'The AI binding is missing. In Cloudflare: Pages project > Settings > Bindings > add Workers AI, name it AI, then redeploy.' }, { status: 500, headers: cors });
  }

  let res;
  try {
    res = await ctx.next();
  } catch (err) {
    const msg = String((err && err.message) || err);
    const status = /rate|limit|capacity|3036|429/i.test(msg) ? 429 : 502;
    console.error('API error', msg);
    res = Response.json({ error: status === 429 ? 'Daily free limit reached or service busy. Try again later.' : 'The AI service failed. Try again.', detail: msg.slice(0, 300) }, { status });
  }
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  out.headers.set('Cache-Control', 'no-store');
  return out;
}
