# Google Analytics 4 (Consent Mode v2) + cookie bar + install-click tracking.
# Shared by build.py (Semafor page) and home.py (studio home). Injected after translation.
import html as H

GA_ID = 'G-X6LMX9VR0Y'
PRIVACY = 'https://semafor-copy-production.up.railway.app/privacy'

# text, accept, decline, privacy link, region label
CONSENT = {
 'en': ('We use analytics cookies to see how visitors find us.', 'Accept', 'Decline', 'Privacy policy', 'Cookies'),
 'ro': ('Folosim cookie-uri de analiză ca să vedem cum ajung vizitatorii la noi.', 'Accept', 'Refuz', 'Confidențialitate', 'Cookie-uri'),
 'es': ('Usamos cookies de analítica para saber cómo nos encuentran los visitantes.', 'Aceptar', 'Rechazar', 'Privacidad', 'Cookies'),
 'fr': ('Nous utilisons des cookies de mesure d’audience pour savoir comment les visiteurs nous trouvent.', 'Accepter', 'Refuser', 'Confidentialité', 'Cookies'),
 'pl': ('Używamy analitycznych plików cookie, żeby wiedzieć, jak trafiają do nas odwiedzający.', 'Akceptuję', 'Odrzucam', 'Prywatność', 'Pliki cookie'),
 'ru': ('Мы используем аналитические cookie, чтобы понимать, как посетители нас находят.', 'Принять', 'Отклонить', 'Конфиденциальность', 'Cookie'),
}

# In <head>: consent default (denied) BEFORE config, then async gtag.js. Restores a stored "granted".
HEAD = '''<script>
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});
try{if(localStorage.getItem('kl_consent')==='granted')gtag('consent','update',{analytics_storage:'granted'})}catch(e){}
gtag('js',new Date());gtag('config','%s');
</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=%s"></script>
''' % (GA_ID, GA_ID)

CSS = '''
.klc{position:fixed;left:12px;right:12px;bottom:12px;z-index:60;max-width:680px;margin:0 auto;display:flex;align-items:center;gap:14px 18px;padding:14px 16px 14px 20px;background:rgba(23,21,18,.96);color:var(--cream);border:1px solid var(--edge);border-radius:18px;box-shadow:0 24px 60px -24px #000;font-family:var(--sans);font-size:14px;line-height:1.45;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.klc[hidden]{display:none}
.klc p{flex:1;margin:0;color:var(--soft)}
.klc p a{color:var(--cream);text-decoration:underline;text-underline-offset:2px;white-space:nowrap}
.klc .klb{display:flex;gap:8px;flex:none}
.klc button{font:inherit;font-size:14px;font-weight:500;min-width:104px;min-height:40px;padding:9px 16px;border-radius:999px;border:1px solid var(--edge);background:rgba(255,255,255,.04);color:var(--cream);cursor:pointer}
.klc button:hover{border-color:var(--mute)}
.klc button:focus-visible,.klc a:focus-visible{outline:2px solid var(--cream);outline-offset:2px}
@media (max-width:560px){.klc{flex-direction:column;align-items:stretch;left:8px;right:8px;bottom:8px;padding:14px}.klc .klb button{flex:1;min-width:0}}
'''

def bar(code):
    t, a, d, p, r = (H.escape(x, quote=False) for x in CONSENT[code])
    return (f'<div class="klc" id="klc" role="region" aria-label="{r}" hidden>'
            f'<p>{t} <a href="{PRIVACY}" target="_blank" rel="noopener">{p}</a></p>'
            f'<div class="klb"><button type="button" data-c="granted">{a}</button>'
            f'<button type="button" data-c="denied">{d}</button></div></div>\n')

# Before </body>: consent bar logic, UTM decoration and install_click event (one delegated listener).
JS = r'''<script>
(function(){
  var K='kl_consent',bar=document.getElementById('klc'),v=null;
  try{v=localStorage.getItem(K)}catch(e){}
  if(bar&&v!=='granted'&&v!=='denied'){bar.hidden=false;
    bar.addEventListener('click',function(e){var b=e.target.closest('button[data-c]');if(!b)return;var c=b.getAttribute('data-c');
      try{localStorage.setItem(K,c)}catch(e){}
      if(c==='granted')gtag('consent','update',{analytics_storage:'granted'});
      bar.hidden=true;});}
  var lang=document.documentElement.lang||'en',src=null,SK='kl_src';
  try{var q=new URLSearchParams(location.search),us=q.get('utm_source'),uc=q.get('utm_campaign'),um=q.get('utm_medium');
    if(us||uc)src={s:us,c:uc,m:um};else if(q.get('fbclid'))src={s:'meta',m:'paid_social'};
    if(src)sessionStorage.setItem(SK,JSON.stringify(src));else src=JSON.parse(sessionStorage.getItem(SK)||'null');}catch(e){}
  function pos(a){
    if(a.closest('nav.top'))return 'nav';if(a.closest('footer'))return 'footer';
    if(a.classList.contains('pill'))return 'hero_badge';if(a.closest('header.hero'))return 'hero';
    var s=a.closest('section');return s?(s.id||(s.classList.contains('final')?'final':'section')):'other';}
  function go(e){
    var a=e.target.closest&&e.target.closest('a[href*="apps.shopify.com/semafor"]');if(!a)return;
    try{var u=new URL(a.href),p=u.searchParams,s=src||{};
      p.set('utm_source',s.s||'kastellabs');p.set('utm_medium',s.m||'website');p.set('utm_campaign',s.c||lang);
      a.href=u.toString();}catch(x){}
    if(e.type==='click'||e.button===1){try{gtag('event','install_click',{lang:lang,position:pos(a),page_path:location.pathname,transport_type:'beacon'})}catch(x){}}
  }
  document.addEventListener('click',go,true);document.addEventListener('auxclick',go,true);
})();
</script>
'''

def inject(h, code):
    """Add GA head snippet (after the language redirect, if any), bar CSS, bar markup and JS."""
    if '<link rel="canonical"' in h:
        h = h.replace('<link rel="canonical"', HEAD + '<link rel="canonical"', 1)
    h = h.replace('</style>', CSS + '</style>', 1)
    h = h.replace('</body>', bar(code) + JS + '</body>', 1)
    return h
