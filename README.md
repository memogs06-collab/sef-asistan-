# Profesyonel Şef Asistanı

Toplu yemek (catering) için 1 porsiyon bazlı standart reçete kitabı. Tek dosyalı HTML uygulama (v77).

- `index.html` : uygulama (794 reçete, açılış sayfası; GitHub Pages ile yayınlanabilir)
- `paketler/paket-001.json` : Paket 001 (150 reçete: 120 Türk mutfağı, 30 dünya mutfağı). Uygulamada Yedekleme > Paket aktar ile eklenebilir; v77'de zaten gömülüdür.
- `araclar/` : paket yazma ve çakışma kontrol betikleri (Python 3)
  - `check.py` : yeni paketi mevcut reçetelere karşı kontrol eder (ad, alternatif ad, benzer ad, ana malzeme)
  - `build.py` : paketi doğrular ve HTML'e gömer: `python build.py index.html yeni.html`
  - `paket-kaynak/` : reçete kaynakları (b01-b07), `enrich.py` ek yöntem metinleri

Kullanıcı verileri tarayıcı yerel depolamasındadır; depoya veri yazılmaz.
