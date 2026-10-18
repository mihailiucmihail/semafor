import re, os, shutil, json, sys, html as H
sys.path.insert(0,'.')
from tr2_ro import RO
from tr2_ru import RU
from tr2_es import ES
from tr2_fr import FR
from tr2_pl import PL
from analytics import inject
from data import LINKS, build_data
SITE='https://www.kastellabs.com'
LANGS=[('en','English',None),('ro','Română',RO),('es','Español',ES),('fr','Français',FR),('pl','Polski',PL),('ru','Русский',RU)]
OG={'en':'en_US','ro':'ro_RO','es':'es_ES','fr':'fr_FR','pl':'pl_PL','ru':'ru_RU'}
EN=json.load(open('strings.en.json'))
tpl=open('template.html').read()
OUT='../site'

BASE='/semafor'
def url(code): return SITE+BASE+'/' if code=='en' else f'{SITE}{BASE}/{code}/'
def path(code): return BASE+'/' if code=='en' else f'{BASE}/{code}/'
def home(code): return '/' if code=='en' else f'/{code}/'

SW_CSS='''
.lang{position:relative}
.lang summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:13.5px;color:var(--soft);padding:8px 12px;border:1px solid var(--edge);border-radius:999px;background:rgba(255,255,255,.03)}
.lang summary::-webkit-details-marker{display:none}
.lang summary svg{width:15px;height:15px}
.lang[open] summary{border-color:var(--mute);color:var(--cream)}
.lang .menu{position:absolute;right:0;top:calc(100% + 8px);background:var(--night-2);border:1px solid var(--edge);border-radius:14px;padding:6px;min-width:170px;box-shadow:0 24px 50px -20px #000;display:flex;flex-direction:column;z-index:50}
.lang .menu a{display:flex!important;justify-content:space-between;gap:16px;padding:9px 12px;border-radius:9px;font-size:14.5px;text-decoration:none;color:var(--cream)}
.lang .menu a:hover{background:var(--night-3)}
.lang .menu a small{color:var(--mute);text-transform:uppercase;font-size:12px}
.lang .menu a[aria-current]{font-weight:600}
html:not([lang=en]) .hero h1{font-size:clamp(46px,6.6vw,92px)}
@media (max-width:600px){.navlinks{gap:8px}.navlinks .btn-glow{padding:9px 14px;font-size:13px}}
'''

CUR=' aria-current="page"'
def switcher(code):
    items=''.join(f'<a class="lang-a" href="{path(c)}" hreflang="{c}" lang="{c}" data-l="{c}"{CUR if c==code else ""}>{n}<small>{c}</small></a>' for c,n,_ in LANGS)
    globe='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>'
    return f'<details class="lang"><summary aria-label="Language">{globe}{code.upper()}</summary><nav class="menu">{items}</nav></details>\n      '

REDIRECT='''<script>
(function(){try{
  var KEY='kl-lang',S=['ro','es','fr','pl','ru'],saved=null;
  try{saved=localStorage.getItem(KEY)}catch(e){}
  if(saved){ if(saved!=='en'&&S.indexOf(saved)>-1&&location.pathname==='/semafor/') location.replace('/semafor/'+saved+'/'+location.hash); return; }
  var ls=(navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||'en']);
  for(var i=0;i<ls.length;i++){var l=String(ls[i]).slice(0,2).toLowerCase(); if(l==='en')return; if(S.indexOf(l)>-1){location.replace('/semafor/'+l+'/'+location.hash);return;}}
}catch(e){}})();
</script>'''

SAVE_JS='''document.querySelectorAll('.lang-a').forEach(function(a){a.addEventListener('click',function(){try{localStorage.setItem('kl-lang',a.getAttribute('data-l'))}catch(e){}})});'''

def translate(html, d, code):
    missing=set()
    def tr(t):
        k=t.strip()
        if k and d and H.unescape(k) in d and k not in d:
            i=t.index(k); return t[:i]+H.escape(d[H.unescape(k)],quote=False)+t[i+len(k):]
        if not k or k not in d: 
            if k and d and k in EN and not re.fullmatch(r'[\d#·\-−+$I]+|Semafor|Kastel Labs|Basic|Pro|mihailiuc\.co@gmail\.com|COD Fraud|Recovery',k): missing.add(k)
            return t
        i=t.index(k); return t[:i]+d[k]+t[i+len(k):]
    out=[]; skip=False
    for tok in re.split(r'(<[^>]+>)',html):
        if tok.startswith('<'):
            low=tok.lower()
            if low.startswith('<script') or low.startswith('<style'): skip=True
            elif low.startswith('</script') or low.startswith('</style'): skip=False
            def attr(m):
                v=m.group(3)
                return m.group(1)+m.group(2)+(d.get(v,v) if d else v)+m.group(2)
            tok=re.sub(r'(\s(?:alt|aria-label|title|content)=)(["\'])(.*?)\2',attr,tok)
            out.append(tok)
        else:
            out.append(tok if skip or not d else tr(tok))
    if missing: print(code,'MISSING',len(missing)); open(f'missing.{code}.txt','w').write('\n'.join(sorted(missing)))
    return ''.join(out)

for code,name,d in LANGS:
    d=({**d,**LINKS[code]} if d else None)
    h=translate(tpl,d,code)
    h=h.replace('<html lang="en">',f'<html lang="{code}">',1)
    alts=''.join(f'<link rel="alternate" hreflang="{c}" href="{url(c)}">\n' for c,_,_ in LANGS)+f'<link rel="alternate" hreflang="x-default" href="{url("en")}">\n'
    head=f'<link rel="canonical" href="{url(code)}">\n{alts}<meta property="og:url" content="{url(code)}">\n<meta property="og:locale" content="{OG[code]}">\n<meta property="og:type" content="website">\n'
    if code=='en': head=REDIRECT+'\n'+head
    h=h.replace('<link rel="icon"',head+'<link rel="icon"',1)
    h=h.replace('</style>',SW_CSS+'</style>',1)
    h=h.replace('<a class="btn btn-glow btn-sm" href="https://apps.shopify.com/semafor"',switcher(code)+'<a class="btn btn-glow btn-sm" href="https://apps.shopify.com/semafor"',1)
    if code!='en': h=h.replace('https://apps.shopify.com/semafor"',f'https://apps.shopify.com/semafor?locale={code}"')
    h=h.replace('(function(){\n  var nav',"(function(){\n  "+SAVE_JS+"\n  var nav",1)
    h=h.replace('href="/" class="kl-mark" data-home',f'href="{home(code)}" class="kl-mark" data-home').replace('<a href="/" data-home>',f'<a href="{home(code)}" data-home>')
    if code!='en': h=h.replace('href="/semafor/data/"',f'href="/semafor/{code}/data/"')
    h=inject(h,code)
    d_=OUT+BASE if code=='en' else f'{OUT}{BASE}/{code}'
    os.makedirs(d_,exist_ok=True)
    open(f'{d_}/index.html','w').write(h)
print('built semafor', [c for c,_,_ in LANGS])
build_data(tpl, SW_CSS, SAVE_JS, LANGS, OG, SITE, OUT)
