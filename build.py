# -*- coding: utf-8 -*-
import json,sys,re
import os
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,HERE);sys.path.insert(0,os.path.join(HERE,'paket-kaynak'))
import check, pk
from enrich import EXTRA
SRC=sys.argv[1];DST=sys.argv[2]  # kullanım: python build.py kaynak.html cikti.html
REVIEWED={("Semizotu Yemeği","Yoğurtlu Semizotu"),("Soğan Dolması","Fransız Soğan Çorbası"),
("Yoğurtlu Kabak Kızartması","Etli Kabak Dolması"),("Yoğurtlu Kabak Kızartması","Kabak Dolması"),("Yoğurtlu Kabak Kızartması","Kabak Çorbası"),
("Yoğurtlu Patlıcan Kızartması","Patlıcan Salatası"),("Yoğurtlu Patlıcan Kızartması","Patlıcan Kebabı")}
ex=json.load(open(os.path.join(HERE,'existing.json')))
new=check.load_batches()
# yöntem zenginleştirme
for r in new:
    if r['name'] in EXTRA: r['method']=r['method'].rstrip()+" "+EXTRA[r['name']]
# kimlik atama: ilk 120 Türk, son 30 dünya
tr=[r for r in new if r['cat']!="Dünya mutfağı"]; dn=[r for r in new if r['cat']=="Dünya mutfağı"]
assert len(tr)==120 and len(dn)==30,(len(tr),len(dn))
for i,r in enumerate(tr,1): r['id']="P01-TR-%03d"%i
for i,r in enumerate(dn,1): r['id']="P01-DN-%03d"%i
order=["id","name","aliases","cat","sub","base","ingredients","method","tips","equip","allergens","binder","binderNote"]
new=[{k:r[k] for k in order} for r in tr+dn]
# doğrulama
iss=[i for i in check.check(new,ex) if (i[1],i[3]) not in REVIEWED]
assert not iss,iss
ids=[r['id'] for r in new]; assert len(set(ids))==150
short=[(r['name'],len(r['method'])) for r in new if len(r['method'])<260]
assert not short,short
for r in new:
    assert r['sub'] and r['tips'] and r['binderNote'], r['name']
    assert all(a>0 for _,a,_ in r['ingredients'])
json.dump({"paket":"paket-001","surum":"v77","sayi":150,"turk":120,"dunya":30,"recipes":new},open(os.path.join(HERE,'..','paketler','paket-001.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=1)
print("OK",len(new),"reçete; min yöntem",min(len(r['method']) for r in new),"karakter; ort",sum(len(r['method']) for r in new)//150)
import collections;print(collections.Counter(r['cat'] for r in new))
# HTML'e göm
s=open(SRC,encoding='utf-8').read()
assert 'const paket001=' not in s
data=json.dumps(new,ensure_ascii=False,separators=(',',':'))
a=s.index('const builtInRecipes=')
s=s[:a]+'/* Geliştirme paketi 001: 120 Türk mutfağı + 30 dünya mutfağı */\nconst paket001='+data+';\n'+s[a:]
tail='...expansion36].filter('
assert s.count(tail)==1
s=s.replace(tail,'...expansion36,...paket001].filter(')
s=s.replace('<title>Profesyonel Şef Asistanı · V73</title>','<title>Profesyonel Şef Asistanı · V77</title>',1)
open(DST,'w',encoding='utf-8').write(s)
print("HTML yazıldı",len(s))
