// Vercel Serverless Function: GET /api/video-ara?q=yemek+adı
// YouTube'da arar, siteye gömülebilir videoları döndürür. Anahtar yalnızca burada (ortam değişkeni) durur.
// Gerekli ortam değişkenleri: YOUTUBE_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
// Not: ücretsiz YouTube kotası günde yaklaşık 100 aramadır; aynı arama 12 saat önbellekten gelir.

const cache = new Map();            // q -> {t, items}
const hits = new Map();             // userId -> [timestamps]
const TTL = 12 * 3600e3;

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}
function limited(uid) {
  const now = Date.now(), a = (hits.get(uid) || []).filter(t => now - t < 3600e3);
  if (a.length >= 40) { hits.set(uid, a); return true; }
  a.push(now); hits.set(uid, a); return false;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Yalnızca GET' });
  const { YOUTUBE_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!YOUTUBE_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return send(res, 500, { ok: false, error: 'Video araması henüz yapılandırılmadı (YOUTUBE_API_KEY eksik)' });
  }
  const auth = String(req.headers['authorization'] || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return send(res, 401, { ok: false, error: 'Giriş gerekli' });

  let user;
  try {
    const r = await fetch(SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token } });
    if (!r.ok) return send(res, 401, { ok: false, error: 'Oturum geçersiz' });
    user = await r.json();
  } catch (e) { return send(res, 502, { ok: false, error: 'Kimlik doğrulama servisine ulaşılamadı' }); }
  if (limited(user.id)) return send(res, 429, { ok: false, error: 'Saatlik arama sınırına ulaştın, biraz sonra tekrar dene' });

  const url = new URL(req.url, 'http://x');
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 120);
  if (q.length < 2) return send(res, 400, { ok: false, error: 'Aranacak yemeği yaz' });

  const key = q.toLocaleLowerCase('tr-TR');
  const c = cache.get(key);
  if (c && Date.now() - c.t < TTL) return send(res, 200, { ok: true, cached: true, items: c.items });

  try {
    const p = new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '8', q, videoEmbeddable: 'true', safeSearch: 'strict', relevanceLanguage: 'tr', regionCode: 'TR', key: YOUTUBE_API_KEY });
    const r = await fetch('https://www.googleapis.com/youtube/v3/search?' + p.toString());
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = (j.error && j.error.message) || ('HTTP ' + r.status);
      if (r.status === 403 && /quota/i.test(m)) return send(res, 429, { ok: false, error: 'YouTube günlük ücretsiz arama kotası doldu, yarın tekrar dene.' });
      return send(res, 502, { ok: false, error: 'YouTube araması başarısız: ' + String(m).slice(0, 160) });
    }
    const items = (j.items || []).filter(x => x.id && x.id.videoId).map(x => ({
      id: x.id.videoId,
      title: x.snippet.title,
      channel: x.snippet.channelTitle,
      thumb: (x.snippet.thumbnails && (x.snippet.thumbnails.medium || x.snippet.thumbnails.default) || {}).url || '',
    }));
    cache.set(key, { t: Date.now(), items });
    return send(res, 200, { ok: true, items });
  } catch (e) {
    return send(res, 502, { ok: false, error: 'YouTube araması başarısız: ' + String(e.message || e).slice(0, 160) });
  }
};
