// Vercel Serverless Function: POST /api/tarif-uret
// Gemini API anahtarı yalnızca burada (ortam değişkeni) durur, tarayıcıya asla gönderilmez.
//
// Gerekli ortam değişkenleri (Vercel > Project > Settings > Environment Variables):
//   GEMINI_API_KEY     Google AI Studio anahtarı
//   SUPABASE_URL       https://xxxx.supabase.co
//   SUPABASE_ANON_KEY  Supabase anon (public) anahtarı
// İsteğe bağlı:
//   GEMINI_MODEL       Varsayılan: gemini-3.8-flash (ücretsiz katmandaki modeli AI Studio'dan kontrol et)

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

const EQUIP = ['stove', 'saucy', 'oven', 'stew', 'soup', 'pastry', 'grill', 'formed', 'salad', 'cold', 'rice', 'pasta', 'fry', 'pan'];
const BINDERS = ['none', 'natural', 'reduction', 'roux', 'starch', 'liaison', 'dough', 'yeast', 'syrup', 'emulsion', 'protein', 'batter'];
const CATS = ['Çorbalar', 'Et yemekleri', 'Tavuk yemekleri', 'Balık ve deniz ürünleri', 'Sebze yemekleri', 'Bakliyat yemekleri', 'Pilav ve bulgur', 'Makarna ve erişte', 'Dolma ve sarma', 'Köfteler', 'Zeytinyağlılar', 'Salatalar', 'Mezeler', 'Börek ve hamur işleri', 'Tatlılar', 'Soslar', 'Garnitürler', 'Türk mutfağı', 'Dünya mutfağı'];
const ALLERGENS = ['Gluten', 'Kabuklu deniz ürünleri', 'Yumurta', 'Balık', 'Yer fıstığı', 'Soya', 'Süt', 'Sert kabuklu yemişler', 'Kereviz', 'Hardal', 'Susam', 'Sülfit', 'Acı bakla', 'Yumuşakçalar'];
const UNITS = ['g', 'ml', 'adet'];

// Basit, en iyi çaba hız sınırı (sunucusuz örnek başına). Asıl koruma Gemini kotası + giriş zorunluluğudur.
const hits = new Map();
function rateLimited(uid) {
  const now = Date.now();
  const arr = (hits.get(uid) || []).filter((t) => now - t < 3600 * 1000);
  if (arr.length >= 30) return true;
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

// Kullanıcıyı ve ROLÜNÜ Supabase'ten doğrular (istemcinin söylediği rol dikkate alınmaz)
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

function buildPrompt(role, istek, mutfak) {
  const home = role === 'ev_kullanicisi';
  const common =
    'Sen dünya mutfağına hakim, Türk mutfağını derinlemesine bilen bir Executive Chef\'sin. ' +
    'Tarif lezzetli, dengeli, uygulanabilir ve gerçekçi olmalı. Tüm metinler Türkçe olmalı. ' +
    'Yapılış aşaması adım adım, ısı/süre/görsel işaretlerle ayrıntılı olmalı (en az 4 cümle). ' +
    'Malzeme adlarını sade yaz (marka, parantez içi uzun açıklama yok). Uydurma bilgi verme. ' +
    'PATATES/DOMATES KURALI: Sulu pişmede patates dağılıp eridiği için pişirmenin sonuna doğru eklenir ve çatal batacak kıvamda alınır; diri kalması gereken taze domates (sote, kavurma, menemen) ocak kapatılınca eklenir. Bunu yöntemde açıkça yaz. ' +
    'ERİYEN MALZEME KURALI: Isıyla eriyen veya kesilen malzemeleri (tereyağı, peynir, krema, çikolata, dondurma, buz, lor) yöntemde ne zaman ekleneceğini belirterek yaz; bunlar genelde en sona, ocaktan alırken veya servis anında eklenir. ' +
    'ÖN İŞLEM KURALI: Kızartılması, haşlanması, ıslatılması, közlenmesi, kavrulması veya ön pişirilmesi gereken her malzeme (ör. patlıcan, patates, kuru bakliyat, dolma yaprağı, lazanya yaprağı, haşlanacak et/tavuk/yumurta) için yapılışta AYRI ve AÇIK bir adım yaz (hangi malzeme, nasıl, ne kadar süre, sonrasında süzme/soğutma). Malzeme listesinde "haşlanmış", "kızarmış" gibi hazır hâl yazıyorsan, o hazırlığı yapılışta mutlaka anlat; kızartma yağı ayrı malzeme olarak yazılmaz, yapılışta belirt.';
  if (home) {
    return (
      common +
      '\n\nKULLANICI TİPİ: Ev mutfağı.\n' +
      '- Tarif TAM OLARAK 4 KİŞİLİK olsun (base = 4); malzeme miktarları 4 kişi için toplam miktardır.\n' +
      '- Evde bulunabilecek malzeme ve ekipmanlarla, pratik ve lezzetli olsun. Endüstriyel terim kullanma.\n' +
      '- Miktar birimi g, ml veya adet olsun (ölçü kaşığı/bardak yerine gram/ml yaz).\n' +
      '- tuzDengesi alanına kısa bir not yaz (ör. peynir/salça tuzlu olduğu için tuz azaltıldı).\n' +
      '- derinKuvetUygun alanını false ve kuvetNotu alanını boş bırak.\n' +
      (mutfak ? '\nKullanıcının mutfağı/tercihi: ' + mutfak + '\n' : '') +
      '\nİSTEK: ' + istek
    );
  }
  return (
    common +
    '\n\nKULLANICI TİPİ: Profesyonel/toplu yemek mutfağı.\n' +
    '- base = 1 (1 PORSİYON). Tüm miktarlar 1 porsiyon için ÇİĞ NET AĞIRLIK (temizlenmiş, fire düşülmüş) olarak g veya ml cinsinden yazılsın; yalnızca sayılabilir ürünlerde (ör. yumurta) adet.\n' +
    '- TUZ KATKISI DENGESİ: Peynir, pastırma, salça, turşu, soya sosu, bulyon, zeytin gibi tuz taşıyan malzemeleri hesaba kat; tuz miktarını buna göre düşür. Toplam tuz yaklaşık 1,0-1,5 g/porsiyon (çorba/sos 1,0-1,2 g) aralığında olsun. Dengeyi tuzDengesi alanında açıkla.\n' +
    '- ALERJENLER: AB 14 alerjen listesinden yalnızca gerçekten içerenleri işaretle: ' + ALLERGENS.join(', ') + '.\n' +
    '- BAĞLAYICI TEKNİĞİ: ' + BINDERS.join(', ') + ' değerlerinden birini seç; binderNote alanında tekniği (ör. nişasta soğuk sıvıda açılır, ayrıca un eklenmez) yaz. Aynı sosa hem un hem nişasta ekleme.\n' +
    '- GN DERİN KÜVET UYUMU: derinKuvetUygun alanı; sulu/hacimli ve toplu bekletmeye uygun yemekler (çorba, yahni, güveç, pilav, sebze yemekleri) true. Pane, kızartma, börek, ızgara, makarna, salata, kalıp/şerbetli tatlı gibi derin yığında ezilen veya buharda bozulan ürünler false. kuvetNotu alanına gerekçeyi ve önerilen küvet derinliğini (ör. 65 mm / 100 mm / 150 mm) yaz.\n' +
    (mutfak ? '\nKullanıcının notu: ' + mutfak + '\n' : '') +
    '\nİSTEK: ' + istek
  );
}

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    aliases: { type: 'array', items: { type: 'string' } },
    cat: { type: 'string', enum: CATS },
    sub: { type: 'string' },
    base: { type: 'integer' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: { ad: { type: 'string' }, miktar: { type: 'number' }, birim: { type: 'string', enum: UNITS } },
        required: ['ad', 'miktar', 'birim'],
      },
    },
    method: { type: 'string' },
    tips: { type: 'string' },
    equip: { type: 'string', enum: EQUIP },
    allergens: { type: 'array', items: { type: 'string' } },
    binder: { type: 'string', enum: BINDERS },
    binderNote: { type: 'string' },
    tuzDengesi: { type: 'string' },
    derinKuvetUygun: { type: 'boolean' },
    kuvetNotu: { type: 'string' },
  },
  required: ['name', 'cat', 'sub', 'base', 'ingredients', 'method', 'tips', 'equip', 'allergens', 'binder', 'binderNote', 'tuzDengesi', 'derinKuvetUygun', 'kuvetNotu'],
};

async function callGemini(prompt) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(MODEL) + ':generateContent';
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY };
  const contents = [{ parts: [{ text: prompt }] }];
  // İki biçimi sırayla dene: güncel (responseFormat) ve klasik (responseMimeType/responseSchema)
  const variants = [
    { contents, generationConfig: { temperature: 0.7, responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: SCHEMA } } } },
    { contents, generationConfig: { temperature: 0.7, responseMimeType: 'application/json', responseSchema: SCHEMA } },
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
    if (r.status === 429 || r.status === 401 || r.status === 403) break; // biçim sorunu değil
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

// Gemini çıktısını uygulamanın tarif biçimine çevirir ve doğrular
function toAppRecipe(g, role) {
  const home = role === 'ev_kullanicisi';
  const name = String(g.name || '').trim();
  if (!name) throw new Error('Tarif adı yok');
  const base = home ? 4 : 1;
  const ingredients = (Array.isArray(g.ingredients) ? g.ingredients : [])
    .map((i) => {
      if (!UNITS.includes(i.birim)) throw new Error('Geçersiz ölçü birimi: ' + i.birim);
      return [String(i.ad || '').trim(), Math.round(Number(i.miktar) * 100) / 100, i.birim];
    })
    .filter((i) => i[0] && Number.isFinite(i[1]) && i[1] > 0);
  if (ingredients.length < 3) throw new Error('Yetersiz malzeme listesi');
  const method = String(g.method || '').trim();
  if (method.length < 80) throw new Error('Yapılış çok kısa');
  const allergens = [...new Set((Array.isArray(g.allergens) ? g.allergens : []).map(String).filter((a) => ALLERGENS.includes(a)))];
  const equip = EQUIP.includes(g.equip) ? g.equip : 'stove';
  const binder = BINDERS.includes(g.binder) ? g.binder : 'none';
  let tips = String(g.tips || '').trim();
  const extra = [];
  if (!home) {
    if (g.tuzDengesi) extra.push('Tuz dengesi: ' + String(g.tuzDengesi).trim());
    extra.push('Derin küvet: ' + (g.derinKuvetUygun ? 'uygun' : 'uygun değil') + (g.kuvetNotu ? ' - ' + String(g.kuvetNotu).trim() : ''));
  } else if (g.tuzDengesi) {
    extra.push(String(g.tuzDengesi).trim());
  }
  if (extra.length) tips = (tips ? tips + ' ' : '') + extra.join(' ');
  return {
    id: 'AI-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    aliases: (Array.isArray(g.aliases) ? g.aliases : []).map((a) => String(a).trim()).filter(Boolean).slice(0, 4),
    cat: CATS.includes(g.cat) ? g.cat : home ? 'Türk mutfağı' : 'Dünya mutfağı',
    sub: String(g.sub || 'Yapay zekâ ile üretildi').trim(),
    base,
    ingredients,
    method,
    tips,
    equip,
    allergens,
    binder,
    binderNote: String(g.binderNote || '').trim(),
    derinKuvetUygun: home ? null : !!g.derinKuvetUygun,
    ai: true,
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
    return send(res, 403, { ok: false, error: 'Bu rol tarif üretemez' });
  }
  if (rateLimited(who.id)) return send(res, 429, { ok: false, error: 'Saatlik tarif üretme sınırına ulaştın, biraz sonra tekrar dene' });

  const body = await readBody(req);
  const istek = String(body.istek || '').trim().slice(0, 600);
  const mutfak = String(body.mutfak || '').trim().slice(0, 300);
  if (istek.length < 3) return send(res, 400, { ok: false, error: 'Ne tarif edilsin? Kısa bir istek yaz.' });

  try {
    const text = await callGemini(buildPrompt(who.role, istek, mutfak));
    const recipe = toAppRecipe(parseJson(text), who.role);
    return send(res, 200, { ok: true, role: who.role, recipe });
  } catch (e) {
    const msg = String(e.message || e);
    if (/Gemini 429/.test(msg)) return send(res, 429, { ok: false, error: 'Yapay zekâ günlük/dakikalık ücretsiz kotası doldu, biraz sonra tekrar dene.' });
    return send(res, 502, { ok: false, error: 'Tarif üretilemedi: ' + msg.slice(0, 220) });
  }
};

module.exports._test = { buildPrompt, toAppRecipe, parseJson };
