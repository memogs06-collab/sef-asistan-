// Vercel Serverless Function: POST /api/foto-tani
// Fotoğraftan malzeme / alerjen / irsaliye-fatura satırı tanıma.
// tarif-uret.js ile AYNI ortam değişkenlerini kullanır (yeni anahtar gerekmez):
//   GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY   (isteğe bağlı: GEMINI_MODEL)
// Görsel kalıcı saklanmaz; yalnızca tanıma için Gemini'ye gönderilir.

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const ALLERGENS = ['Gluten', 'Kabuklu deniz ürünleri', 'Yumurta', 'Balık', 'Yer fıstığı', 'Soya', 'Süt', 'Sert kabuklu yemişler', 'Kereviz', 'Hardal', 'Susam', 'Sülfit', 'Acı bakla', 'Yumuşakçalar'];
const UNITS = ['kg', 'lt', 'adet', 'paket', 'kutu'];
const MODES = ['malzeme', 'alerjen', 'belge'];
const MAX_B64 = 4 * 1024 * 1024; // ~3 MB görsel; istemci zaten küçültür

const hits = new Map();
function rateLimited(uid) {
  const now = Date.now();
  const arr = (hits.get(uid) || []).filter((t) => now - t < 3600 * 1000);
  if (arr.length >= 20) return true;
  arr.push(now);
  hits.set(uid, arr);
  return false;
}

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { return {}; }
}

async function getUserAndRole(token) {
  const base = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const u = await fetch(base + '/auth/v1/user', { headers: { apikey: anon, Authorization: 'Bearer ' + token } });
  if (!u.ok) return null;
  const user = await u.json();
  if (!user || !user.id) return null;
  const p = await fetch(base + '/rest/v1/profiles?id=eq.' + encodeURIComponent(user.id) + '&select=role', {
    headers: { apikey: anon, Authorization: 'Bearer ' + token },
  });
  if (!p.ok) return null;
  const rows = await p.json();
  if (!rows || !rows[0]) return null;
  return { id: user.id, role: rows[0].role };
}

function buildPrompt(mode) {
  const common =
    'Sen mutfak ve gıda güvenliği konusunda deneyimli bir yardımcısın. Tüm metinler Türkçe olmalı. ' +
    'Yalnızca fotoğrafta gerçekten gördüğünü yaz; emin olmadığın şeyi uydurma, listeye ekleme. ' +
    'Ürün adlarını sade yaz (marka adı yok). Miktar bilinmiyorsa 0 yaz. Birimi kg, lt, adet, paket veya kutu seç. ';
  if (mode === 'alerjen') {
    return (
      common +
      'GÖREV: Fotoğraftaki yemek, ürün ya da ambalajdaki içeriği oku. Görünen/yazan malzemeleri "urunler" listesine, ' +
      'içerdiğini düşündüğün alerjenleri yalnızca şu AB listesinden seçerek "alerjenler" alanına yaz: ' + ALLERGENS.join(', ') + '. ' +
      'Ambalajda "içerir/iz miktarda içerebilir" yazıyorsa onu esas al. "ozet" alanına tek cümle yaz ve görüntüden kesin emin olunamayan durumu belirt.'
    );
  }
  if (mode === 'belge') {
    return (
      common +
      'GÖREV: Bu bir irsaliye, fatura ya da fiş fotoğrafı. Üst bilgileri (tedarikçi adı, tarih YYYY-MM-DD, genel toplam) ve ' +
      'her ürün satırını (ad, miktar, birim, birim fiyat) çıkar. Okunamayan alanı boş/0 bırak. Ürün olmayan satırları (KDV, ara toplam) "urunler"e yazma.'
    );
  }
  return (
    common +
    'GÖREV: Fotoğraftaki (raf, dolap, tezgâh, alışveriş) gıda ve mutfak malzemelerini say. Her farklı malzeme için bir satır yaz; ' +
    'görünür adedi ya da yaklaşık miktarı "miktar" alanına yaz. Ambalajlı ürünlerde paket/kutu say.'
  );
}

const SCHEMA = {
  type: 'object',
  properties: {
    ozet: { type: 'string' },
    tedarikci: { type: 'string' },
    tarih: { type: 'string' },
    toplam: { type: 'number' },
    alerjenler: { type: 'array', items: { type: 'string' } },
    urunler: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ad: { type: 'string' },
          miktar: { type: 'number' },
          birim: { type: 'string', enum: UNITS },
          fiyat: { type: 'number' },
          alerjenler: { type: 'array', items: { type: 'string' } },
        },
        required: ['ad', 'miktar', 'birim'],
      },
    },
  },
  required: ['ozet', 'urunler'],
};

async function callGemini(prompt, mime, b64) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(MODEL) + ':generateContent';
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY };
  const contents = [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }];
  const variants = [
    { contents, generationConfig: { temperature: 0.2, responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: SCHEMA } } } },
    { contents, generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: SCHEMA } },
  ];
  let lastErr = '';
  for (const body of variants) {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const txt = await r.text();
    if (r.ok) {
      let j;
      try { j = JSON.parse(txt); } catch (e) { lastErr = 'Gemini yanıtı çözülemedi'; continue; }
      const parts = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
      const out = parts && parts.map((p) => p.text || '').join('');
      if (out) return out;
      lastErr = 'Gemini boş yanıt döndürdü';
      continue;
    }
    lastErr = 'Gemini ' + r.status + ': ' + txt.slice(0, 200);
    if (r.status === 429 || r.status === 401 || r.status === 403) break;
  }
  throw new Error(lastErr || 'Gemini hatası');
}

function parseJson(text) {
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

function clean(g) {
  const al = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map(String).filter((a) => ALLERGENS.includes(a)))];
  const items = (Array.isArray(g.urunler) ? g.urunler : [])
    .map((i) => ({
      ad: String(i.ad || '').trim().slice(0, 80),
      miktar: Math.max(0, Math.round((Number(i.miktar) || 0) * 100) / 100),
      birim: UNITS.includes(i.birim) ? i.birim : 'adet',
      fiyat: Math.max(0, Math.round((Number(i.fiyat) || 0) * 100) / 100),
      alerjenler: al(i.alerjenler),
    }))
    .filter((i) => i.ad)
    .slice(0, 60);
  const all = al(g.alerjenler);
  items.forEach((i) => i.alerjenler.forEach((a) => { if (!all.includes(a)) all.push(a); }));
  return {
    ozet: String(g.ozet || '').trim().slice(0, 300),
    tedarikci: String(g.tedarikci || '').trim().slice(0, 80),
    tarih: /^\d{4}-\d{2}-\d{2}$/.test(String(g.tarih || '')) ? g.tarih : '',
    toplam: Math.max(0, Number(g.toplam) || 0),
    alerjenler: all,
    urunler: items,
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Yalnızca POST' });
  if (!process.env.GEMINI_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return send(res, 500, { ok: false, error: 'Sunucu yapılandırması eksik (ortam değişkenleri)' });
  }
  const auth = String(req.headers['authorization'] || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return send(res, 401, { ok: false, error: 'Giriş gerekli' });

  let who;
  try { who = await getUserAndRole(token); } catch (e) { return send(res, 502, { ok: false, error: 'Kimlik doğrulama servisine ulaşılamadı' }); }
  if (!who) return send(res, 401, { ok: false, error: 'Oturum geçersiz' });
  if (!['ev_kullanicisi', 'ustabasi', 'super_admin'].includes(who.role)) {
    return send(res, 403, { ok: false, error: 'Bu rol fotoğraf tanıma kullanamaz' });
  }
  if (rateLimited(who.id)) return send(res, 429, { ok: false, error: 'Saatlik fotoğraf tanıma sınırına ulaştın, biraz sonra tekrar dene' });

  const body = await readBody(req);
  const mode = MODES.includes(body.mod) ? body.mod : 'malzeme';
  const mime = ['image/jpeg', 'image/png', 'image/webp'].includes(body.mime) ? body.mime : 'image/jpeg';
  const b64 = String(body.image || '').replace(/^data:[^,]*,/, '');
  if (b64.length < 200) return send(res, 400, { ok: false, error: 'Fotoğraf yok ya da okunamadı' });
  if (b64.length > MAX_B64) return send(res, 413, { ok: false, error: 'Fotoğraf çok büyük, daha küçük çekip tekrar dene' });

  try {
    const text = await callGemini(buildPrompt(mode), mime, b64);
    const data = clean(parseJson(text));
    return send(res, 200, { ok: true, mod: mode, sonuc: data });
  } catch (e) {
    const msg = String(e.message || e);
    if (/Gemini 429/.test(msg)) return send(res, 429, { ok: false, error: 'Yapay zekâ kotası doldu, biraz sonra tekrar dene.' });
    return send(res, 502, { ok: false, error: 'Fotoğraf tanınamadı: ' + msg.slice(0, 220) });
  }
};

module.exports._test = { buildPrompt, clean, parseJson };
