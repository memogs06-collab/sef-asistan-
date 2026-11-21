# -*- coding: utf-8 -*-
import json,re,sys,glob,importlib,unicodedata
import os
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,os.path.join(HERE,'paket-kaynak'))
import pk
def norm(s):
    s=s.replace('İ','i').replace('I','ı').lower().replace('ı','i')
    s=unicodedata.normalize('NFD',s); s=''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9 ]+',' ',s).strip()
GEN=set("usulu yemegi yemek corbasi corba kebabi kebap koftesi kofte tatlisi pilavi salatasi dolmasi sarmasi boregi ve ile firin izgara tava sote guvec yoresel geleneksel klasik etli".split())
def key(n): return [t for t in norm(n).split() if t not in GEN]
SKIP=set("tuz su karabiber sivi yag zeytinyagi tereyagi toz seker pul biber nane kimyon kekik sarimsak limon suyu et suyu tavuk suyu sirke maya un yumurta soğan sogan kuru kuzu".split())
def main_ing(ings):
    best=None
    for n,a,u in ings:
        nn=norm(n)
        if any(w in nn for w in ["tuz","su ","suyu","baharat","karabiber","yag","biber","nane","kekik","kimyon","sarimsak","limon","sirke","maya","seker","tarcin","defne"]) or nn=="su": continue
        if u=="adet": a=a*50
        if best is None or a>best[1]: best=(n,a)
    return best[0] if best else ""
def load_batches():
    pk.ALL.clear(); pk.SHORT.clear()
    for f in sorted(glob.glob(os.path.join(HERE,'paket-kaynak','b[0-9][0-9].py'))):
        name=f.split('/')[-1][:-3]
        if name in sys.modules: del sys.modules[name]
        importlib.import_module(name)
    return pk.ALL
def check(new,existing):
    issues=[];names={}
    ex_names={};ex_keys=[]
    for e in existing:
        for n in [e['name']]+e['aliases']:
            ex_names[norm(n)]=e['name']
        ex_keys.append((set(key(e['name'])),e))
    seen={}
    for r in new:
        for n in [r['name']]+r['aliases']:
            k=norm(n)
            if k in ex_names: issues.append(("ADI MEVCUT",r['name'],n,ex_names[k]))
            if k in seen and seen[k]!=r['name']: issues.append(("PAKET İÇİ ÇAKIŞMA",r['name'],n,seen[k]))
            seen[k]=r['name']
        kt=set(key(r['name'])); mi=norm(main_ing(r['ingredients']))
        for ks,e in ex_keys:
            if not kt or not ks: continue
            j=len(kt&ks)/len(kt|ks)
            if j>=0.6 and norm(e['name'])!=norm(r['name']): issues.append(("BENZER AD %.2f"%j,r['name'],'',e['name']))
            elif kt<=ks or ks<=kt:
                if len(kt)>=1 and len(ks)>=1 and (kt&ks) and mi and mi==norm(main_ing(e['ing'])) and len(kt&ks)>=1 and (len(kt)<=2 or len(ks)<=2):
                    issues.append(("AYNI ANA MALZEME+AD",r['name'],mi,e['name']))
    return issues
if __name__=="__main__":
    ex=json.load(open(os.path.join(HERE,'existing.json')))
    new=load_batches()
    iss=check(new,ex)
    print(len(new),"reçete;",len(iss),"çakışma")
    for i in iss: print(i)
    print("KISA YÖNTEM:",pk.SHORT)
