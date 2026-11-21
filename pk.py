# -*- coding: utf-8 -*-
import re, json
ALL=[]
SHORT=[]
BNOTE={"none":"Ayrı bağlayıcı kullanılmaz.","natural":"Malzemenin kendi nişastası ve yapısı kıvam verir; ayrıca un veya nişasta eklenmez.",
"reduction":"Kıvam, sıvının kontrollü indirgenmesiyle sağlanır; un veya nişasta eklenmez.","roux":"Yağda kavrulan un (meyane) kıvam verir.",
"liaison":"Yumurta/yoğurt terbiyesi ılıştırılarak eklenir; kaynatılmaz.","dough":"Hamurun kendi yapısı bağlayıcıdır.","starch":"Nişasta kontrollü eklenir.",
"syrup":"Şerbet yapısı ve ısı kontrolü tatlıya kıvam verir.","protein":"Et/yumurta proteini bağlayıcı görevi görür.","batter":"Hamur akışkanlığı kontrollü ayarlanır.","emulsion":"Emülsiyon; yağ ve su kontrollü birleştirilerek sos kıvamı oluşur.","steam":"Buharla pişirme yapıyı oluşturur.","yeast":"Maya ve dinlendirme yapıyı oluşturur."}
def R(names,cat,sub,equip,binder,allergens,ings,method,tips,bnote=None,base=1):
    n=[x.strip() for x in names.split("|")]
    L=[]
    for part in ings.split(","):
        part=part.strip()
        m=re.match(r"^(.+?):\s*([\d.]+)\s*(g|ml|adet)$",part)
        assert m,("Malzeme biçimi hatalı",n[0],part)
        a=float(m.group(2)); a=int(a) if a==int(a) else a
        L.append([m.group(1).strip(),a,m.group(3)])
    assert len(L)>=5,(n[0],"az malzeme")
    if len(method)<260: SHORT.append((n[0],len(method)))
    ALL.append({"name":n[0],"aliases":n[1:],"cat":cat,"sub":sub,"base":base,"ingredients":L,"method":method.strip(),"tips":tips.strip(),
      "equip":equip,"allergens":[a for a in allergens.split(",") if a],"binder":binder,"binderNote":bnote or BNOTE.get(binder,"")})
