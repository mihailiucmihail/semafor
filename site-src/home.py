# Kastel Labs home page (studio) — www.kastellabs.com/ and /ro/ /es/ /fr/ /pl/ /ru/
# Run after build.py (which writes the Semafor page under /semafor). Also writes sitemap.xml + robots.txt for both.
import os, html as H
from analytics import inject
SITE = 'https://www.kastellabs.com'
OUT = '../site'
LANGS = [('en', 'English'), ('ro', 'Română'), ('es', 'Español'), ('fr', 'Français'), ('pl', 'Polski'), ('ru', 'Русский')]
OG = {'en': 'en_US', 'ro': 'ro_RO', 'es': 'es_ES', 'fr': 'fr_FR', 'pl': 'pl_PL', 'ru': 'ru_RU'}
MAIL = 'mihailiuc.co@gmail.com'
PRIVACY = 'https://semafor-copy-production.up.railway.app/privacy'

T = {
 'en': dict(
  title='Kastel Labs — Shopify apps for cash-on-delivery stores',
  desc='Kastel Labs builds premium Shopify apps for stores that sell with cash on delivery. Our first app, Semafor, stops refused parcels and wins back abandoned checkouts.',
  nav_apps='Apps', nav_why='Why us', nav_contact='Contact',
  eyebrow='Shopify app studio',
  h1a='Apps that protect', h1b='every sale.',
  lead='We build Shopify apps for stores that sell with cash on delivery — calm, precise tools that stop losses before a parcel leaves and bring customers back after they leave.',
  cta1='Discover Semafor', cta2='Talk to us',
  app_eyebrow='Our app', app_tag='COD fraud protection & checkout recovery',
  app_text='A traffic light on every order. Semafor spots buyers who refuse cash-on-delivery parcels — even under a new name — hides cash on delivery for them at checkout, and wins back the carts customers leave behind.',
  f1='Green, yellow or red on every order, in seconds', f2='Cash on delivery hidden for risky buyers', f3='Same person, new name — linked by device', f4='Up to 3 automatic reminder e-mails',
  app_more='Explore Semafor', app_install='Install on Shopify', app_trial='14 days of Pro free · no card needed',
  o1='Prepaid · trusted buyer', o2='COD already on the way', o3='Refused 2 parcels · COD hidden',
  why_eyebrow='How we build', why_h='Made for the way you sell.',
  w1h='Built for cash on delivery', w1p='Every feature starts from one question: will this parcel come back paid?',
  w2h='Works from the first minute', w2p='Install it and it runs. No setup marathon, no third-party accounts, no code.',
  w3h='Private by design', w3p='Stores share anonymous fingerprints, never names or addresses. Your customers’ data stays yours.',
  w4h='Six languages', w4p='The app speaks English, Romanian, Spanish, French, Polish and Russian. Customers get e-mails and the pop-up in English, Romanian, German, Polish or Spanish.',
  c_eyebrow='Contact', c_h='Questions? A real person answers.', c_p='Write to us about Semafor, a feature you need or a problem in your store.', c_btn='Write to us',
  foot_privacy='Privacy policy', foot_store='Shopify App Store', lang='Language'),
 'ro': dict(
  title='Kastel Labs — aplicații Shopify pentru magazinele cu plată ramburs',
  desc='Kastel Labs creează aplicații Shopify premium pentru magazinele care vând cu plată ramburs. Prima noastră aplicație, Semafor, oprește coletele refuzate și recuperează comenzile abandonate.',
  nav_apps='Aplicații', nav_why='De ce noi', nav_contact='Contact',
  eyebrow='Studio de aplicații Shopify',
  h1a='Aplicații care protejează', h1b='fiecare vânzare.',
  lead='Creăm aplicații Shopify pentru magazinele care vând cu plată ramburs — instrumente calme și precise, care opresc pierderile înainte să plece coletul și îi aduc înapoi pe clienții care au plecat.',
  cta1='Descoperă Semafor', cta2='Scrie-ne',
  app_eyebrow='Aplicația noastră', app_tag='Protecție la ramburs și recuperarea comenzilor',
  app_text='Un semafor pe fiecare comandă. Semafor recunoaște clienții care refuză coletele ramburs — chiar și sub alt nume —, le ascunde plata ramburs la finalizarea comenzii și recuperează coșurile abandonate.',
  f1='Verde, galben sau roșu pe fiecare comandă, în câteva secunde', f2='Plata ramburs ascunsă pentru clienții riscanți', f3='Aceeași persoană, alt nume — recunoscută după dispozitiv', f4='Până la 3 e-mailuri automate de reamintire',
  app_more='Descoperă Semafor', app_install='Instalează în Shopify', app_trial='14 zile de Pro gratuit · fără card',
  o1='Plătită online · client de încredere', o2='Are deja un colet ramburs pe drum', o3='A refuzat 2 colete · ramburs ascuns',
  why_eyebrow='Cum lucrăm', why_h='Făcute pentru felul în care vinzi.',
  w1h='Gândite pentru ramburs', w1p='Fiecare funcție pornește de la o singură întrebare: se întoarce coletul plătit?',
  w2h='Funcționează din primul minut', w2p='O instalezi și pornește. Fără configurări lungi, fără conturi la terți.',
  w3h='Confidențialitate din construcție', w3p='Magazinele partajează doar amprente anonime, niciodată nume sau adrese. Datele clienților tăi rămân ale tale.',
  w4h='Șase limbi', w4p='Aplicația vorbește engleză, română, spaniolă, franceză, poloneză și rusă. Clienții primesc e-mailurile și pop-up-ul în engleză, română, germană, poloneză sau spaniolă.',
  c_eyebrow='Contact', c_h='Întrebări? Îți răspunde un om.', c_p='Scrie-ne despre Semafor, despre o funcție de care ai nevoie sau despre o problemă din magazin.', c_btn='Scrie-ne',
  foot_privacy='Politica de confidențialitate', foot_store='Shopify App Store', lang='Limba'),
 'es': dict(
  title='Kastel Labs — apps de Shopify para tiendas con pago contra reembolso',
  desc='Kastel Labs crea apps premium de Shopify para tiendas que venden con pago contra reembolso. Nuestra primera app, Semafor, frena los paquetes rechazados y recupera los checkouts abandonados.',
  nav_apps='Apps', nav_why='Por qué nosotros', nav_contact='Contacto',
  eyebrow='Estudio de apps para Shopify',
  h1a='Apps que protegen', h1b='cada venta.',
  lead='Creamos apps de Shopify para tiendas que venden contra reembolso: herramientas tranquilas y precisas que frenan las pérdidas antes de que salga el paquete y recuperan a los clientes que se fueron.',
  cta1='Descubre Semafor', cta2='Escríbenos',
  app_eyebrow='Nuestra app', app_tag='Protección contra reembolso y recuperación de carritos',
  app_text='Un semáforo en cada pedido. Semafor detecta a los compradores que rechazan paquetes contra reembolso —incluso con otro nombre—, les oculta ese pago en el checkout y recupera los carritos abandonados.',
  f1='Verde, amarillo o rojo en cada pedido, en segundos', f2='Contra reembolso oculto para compradores de riesgo', f3='Misma persona, otro nombre: vinculada por dispositivo', f4='Hasta 3 e-mails de recordatorio automáticos',
  app_more='Descubre Semafor', app_install='Instalar en Shopify', app_trial='14 días de Pro gratis · sin tarjeta',
  o1='Prepago · comprador de confianza', o2='Ya tiene un reembolso en camino', o3='Rechazó 2 paquetes · reembolso oculto',
  why_eyebrow='Cómo trabajamos', why_h='Hechas para tu forma de vender.',
  w1h='Pensadas para el contra reembolso', w1p='Cada función parte de una pregunta: ¿volverá este paquete pagado?',
  w2h='Funciona desde el primer minuto', w2p='La instalas y funciona. Sin configuraciones eternas ni cuentas de terceros.',
  w3h='Privacidad desde el diseño', w3p='Las tiendas comparten huellas anónimas, nunca nombres ni direcciones. Los datos de tus clientes siguen siendo tuyos.',
  w4h='Seis idiomas', w4p='La app está en inglés, rumano, español, francés, polaco y ruso. Los clientes reciben los e-mails y el pop-up en inglés, rumano, alemán, polaco o español.',
  c_eyebrow='Contacto', c_h='¿Preguntas? Te responde una persona.', c_p='Escríbenos sobre Semafor, una función que necesitas o un problema en tu tienda.', c_btn='Escríbenos',
  foot_privacy='Política de privacidad', foot_store='Shopify App Store', lang='Idioma'),
 'fr': dict(
  title='Kastel Labs — apps Shopify pour les boutiques avec paiement à la livraison',
  desc='Kastel Labs crée des apps Shopify premium pour les boutiques qui vendent avec paiement à la livraison. Notre première app, Semafor, stoppe les colis refusés et récupère les paniers abandonnés.',
  nav_apps='Apps', nav_why='Pourquoi nous', nav_contact='Contact',
  eyebrow='Studio d’apps Shopify',
  h1a='Des apps qui protègent', h1b='chaque vente.',
  lead='Nous créons des apps Shopify pour les boutiques qui vendent avec paiement à la livraison : des outils calmes et précis qui stoppent les pertes avant l’envoi du colis et font revenir les clients partis.',
  cta1='Découvrir Semafor', cta2='Nous écrire',
  app_eyebrow='Notre app', app_tag='Protection du paiement à la livraison et récupération des paniers',
  app_text='Un feu tricolore sur chaque commande. Semafor repère les acheteurs qui refusent les colis en paiement à la livraison — même sous un autre nom —, leur masque ce paiement au checkout et récupère les paniers abandonnés.',
  f1='Vert, orange ou rouge sur chaque commande, en quelques secondes', f2='Paiement à la livraison masqué pour les acheteurs à risque', f3='Même personne, autre nom : reliée par l’appareil', f4='Jusqu’à 3 e-mails de relance automatiques',
  app_more='Découvrir Semafor', app_install='Installer sur Shopify', app_trial='14 jours de Pro offerts · sans carte',
  o1='Prépayé · acheteur fiable', o2='Un colis à la livraison déjà en route', o3='A refusé 2 colis · paiement masqué',
  why_eyebrow='Notre façon de faire', why_h='Pensées pour votre façon de vendre.',
  w1h='Conçues pour le paiement à la livraison', w1p='Chaque fonction part d’une question : ce colis reviendra-t-il payé ?',
  w2h='Opérationnelle dès la première minute', w2p='Installez-la, elle fonctionne. Pas de longue configuration, pas de compte tiers.',
  w3h='Confidentielle par conception', w3p='Les boutiques partagent des empreintes anonymes, jamais de noms ni d’adresses. Les données de vos clients restent les vôtres.',
  w4h='Six langues', w4p='L’app parle anglais, roumain, espagnol, français, polonais et russe. Les clients reçoivent les e-mails et le pop-up en anglais, roumain, allemand, polonais ou espagnol.',
  c_eyebrow='Contact', c_h='Des questions ? Une vraie personne vous répond.', c_p='Écrivez-nous au sujet de Semafor, d’une fonction dont vous avez besoin ou d’un problème dans votre boutique.', c_btn='Nous écrire',
  foot_privacy='Politique de confidentialité', foot_store='Shopify App Store', lang='Langue'),
 'pl': dict(
  title='Kastel Labs — aplikacje Shopify dla sklepów z płatnością za pobraniem',
  desc='Kastel Labs tworzy aplikacje Shopify premium dla sklepów sprzedających za pobraniem. Nasza pierwsza aplikacja, Semafor, zatrzymuje nieodebrane paczki i odzyskuje porzucone koszyki.',
  nav_apps='Aplikacje', nav_why='Dlaczego my', nav_contact='Kontakt',
  eyebrow='Studio aplikacji Shopify',
  h1a='Aplikacje, które chronią', h1b='każdą sprzedaż.',
  lead='Tworzymy aplikacje Shopify dla sklepów sprzedających za pobraniem — spokojne i precyzyjne narzędzia, które zatrzymują straty, zanim paczka wyjedzie, i przyprowadzają z powrotem klientów, którzy odeszli.',
  cta1='Poznaj Semafor', cta2='Napisz do nas',
  app_eyebrow='Nasza aplikacja', app_tag='Ochrona płatności za pobraniem i odzyskiwanie koszyków',
  app_text='Sygnalizator na każdym zamówieniu. Semafor rozpoznaje klientów, którzy nie odbierają paczek za pobraniem — nawet pod innym nazwiskiem — ukrywa im tę płatność w kasie i odzyskuje porzucone koszyki.',
  f1='Zielone, żółte lub czerwone na każdym zamówieniu, w kilka sekund', f2='Płatność za pobraniem ukryta dla ryzykownych klientów', f3='Ta sama osoba, inne nazwisko — powiązana po urządzeniu', f4='Do 3 automatycznych e-maili z przypomnieniem',
  app_more='Poznaj Semafor', app_install='Zainstaluj w Shopify', app_trial='14 dni Pro za darmo · bez karty',
  o1='Opłacone z góry · zaufany klient', o2='Paczka za pobraniem już w drodze', o3='Nie odebrał 2 paczek · pobranie ukryte',
  why_eyebrow='Jak pracujemy', why_h='Stworzone pod Twój sposób sprzedaży.',
  w1h='Zaprojektowane pod pobranie', w1p='Każda funkcja zaczyna się od pytania: czy ta paczka wróci opłacona?',
  w2h='Działa od pierwszej minuty', w2p='Instalujesz i działa. Bez długiej konfiguracji i kont u innych dostawców.',
  w3h='Prywatność w standardzie', w3p='Sklepy wymieniają się anonimowymi odciskami, nigdy nazwiskami ani adresami. Dane Twoich klientów zostają u Ciebie.',
  w4h='Sześć języków', w4p='Aplikacja mówi po angielsku, rumuńsku, hiszpańsku, francusku, polsku i rosyjsku. Klienci dostają e-maile i pop-up po angielsku, rumuńsku, niemiecku, polsku lub hiszpańsku.',
  c_eyebrow='Kontakt', c_h='Pytania? Odpowiada prawdziwy człowiek.', c_p='Napisz do nas o Semaforze, o funkcji, której potrzebujesz, albo o problemie w sklepie.', c_btn='Napisz do nas',
  foot_privacy='Polityka prywatności', foot_store='Shopify App Store', lang='Język'),
 'ru': dict(
  title='Kastel Labs — приложения Shopify для магазинов с наложенным платежом',
  desc='Kastel Labs делает премиальные приложения Shopify для магазинов, которые продают с наложенным платежом. Наше первое приложение, Semafor, останавливает отказы от посылок и возвращает брошенные корзины.',
  nav_apps='Приложения', nav_why='Почему мы', nav_contact='Контакты',
  eyebrow='Студия приложений для Shopify',
  h1a='Приложения, которые берегут', h1b='каждую продажу.',
  lead='Мы делаем приложения Shopify для магазинов с наложенным платежом — спокойные и точные инструменты, которые останавливают потери ещё до отправки посылки и возвращают ушедших покупателей.',
  cta1='Узнать о Semafor', cta2='Написать нам',
  app_eyebrow='Наше приложение', app_tag='Защита наложенного платежа и возврат корзин',
  app_text='Светофор на каждом заказе. Semafor узнаёт покупателей, которые отказываются от посылок с наложенным платежом, — даже под новым именем, — скрывает для них этот способ оплаты и возвращает брошенные корзины.',
  f1='Зелёный, жёлтый или красный на каждом заказе — за секунды', f2='Наложенный платёж скрыт для рискованных покупателей', f3='Тот же человек, новое имя — связан по устройству', f4='До 3 автоматических писем-напоминаний',
  app_more='Узнать о Semafor', app_install='Установить в Shopify', app_trial='14 дней Pro бесплатно · без карты',
  o1='Предоплата · надёжный покупатель', o2='Наложенный платёж уже в пути', o3='Отказался от 2 посылок · оплата скрыта',
  why_eyebrow='Как мы работаем', why_h='Сделано под то, как вы продаёте.',
  w1h='Создано для наложенного платежа', w1p='Каждая функция начинается с одного вопроса: вернётся ли посылка оплаченной?',
  w2h='Работает с первой минуты', w2p='Установили — и работает. Без долгой настройки и сторонних аккаунтов.',
  w3h='Конфиденциально по устройству', w3p='Магазины обмениваются анонимными отпечатками, никогда — именами и адресами. Данные ваших покупателей остаются у вас.',
  w4h='Шесть языков', w4p='Приложение работает на английском, румынском, испанском, французском, польском и русском. Письма и pop-up покупатели получают на английском, румынском, немецком, польском или испанском.',
  c_eyebrow='Контакты', c_h='Есть вопросы? Ответит живой человек.', c_p='Напишите нам о Semafor, о нужной функции или о проблеме в вашем магазине.', c_btn='Написать нам',
  foot_privacy='Политика конфиденциальности', foot_store='Shopify App Store', lang='Язык'),
}

def home(c): return '/' if c == 'en' else f'/{c}/'
def semafor(c): return '/semafor/' if c == 'en' else f'/semafor/{c}/'
def url(p): return SITE + p

CSS = r'''
:root{--night:#0F0E0C;--night-2:#171512;--night-3:#211E1A;--edge:#2E2A25;--mute:#8F877B;--soft:#BDB5A8;--cream:#F4EFE6;--ivory:#F1EDE5;--ink:#1B1916;--ink-2:#4A453E;--ink-3:#7C756A;--line:#DED7CA;--red:#E0483C;--amber:#F2A23A;--green:#27B874;--serif:"Instrument Serif","Cormorant Garamond",Georgia,serif;--sans:"Inter Tight",system-ui,-apple-system,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}
body{background:var(--night);color:var(--cream);font-family:var(--sans);font-size:17px;line-height:1.55;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:inherit}img{max-width:100%;display:block}
.wrap{max-width:1180px;margin:0 auto;padding:0 28px;position:relative}
.eyebrow{font-size:12.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--mute);font-weight:500}
.serif{font-family:var(--serif);font-weight:400;letter-spacing:-.012em}
.btn{display:inline-flex;align-items:center;gap:10px;padding:14px 22px;border-radius:999px;font-size:15.5px;font-weight:500;text-decoration:none;transition:transform .25s,box-shadow .25s,border-color .25s}
.btn-glow{background:var(--cream);color:var(--night);box-shadow:0 0 0 1px rgba(255,255,255,.1),0 10px 40px -10px rgba(39,184,116,.55)}
.btn-glow:hover{transform:translateY(-2px);box-shadow:0 0 0 1px rgba(255,255,255,.2),0 16px 50px -10px rgba(39,184,116,.75)}
.btn-line{border:1px solid var(--edge);color:var(--cream);background:rgba(255,255,255,.02)}.btn-line:hover{border-color:var(--mute)}
.btn-ink{background:var(--ink);color:#F8F5EF}.btn-ink:hover{transform:translateY(-2px)}
.btn-sm{padding:10px 17px;font-size:14px}
nav.top{position:fixed;top:0;left:0;right:0;z-index:40;transition:background .3s,border-color .3s;border-bottom:1px solid transparent}
nav.top.scrolled{background:rgba(15,14,12,.8);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom-color:var(--edge)}
nav.top .wrap{display:flex;align-items:center;justify-content:space-between;height:72px}
.logo{display:flex;align-items:center;gap:12px;text-decoration:none}
.logo img{width:26px;height:31px}
.logo .mark{width:30px;height:30px;border-radius:9px;background:linear-gradient(145deg,#2a2622,#14120f);border:1px solid var(--edge);display:grid;place-items:center}
.logo .mark i{display:block;width:4px;height:14px;border-radius:2px;background:var(--cream);box-shadow:6px 0 0 var(--soft),-6px 0 0 var(--soft)}
.logo span{font-family:var(--serif);font-size:24px;letter-spacing:.01em}
.navlinks{display:flex;gap:28px;align-items:center;font-size:15px}
.navlinks>a:not(.btn){text-decoration:none;color:var(--soft)}.navlinks>a:not(.btn):hover{color:var(--cream)}
.lang{position:relative}
.lang summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:13.5px;color:var(--soft);padding:8px 12px;border:1px solid var(--edge);border-radius:999px;background:rgba(255,255,255,.03)}
.lang summary::-webkit-details-marker{display:none}.lang summary svg{width:15px;height:15px}
.lang .menu{position:absolute;right:0;top:calc(100% + 8px);background:var(--night-2);border:1px solid var(--edge);border-radius:14px;padding:6px;min-width:170px;box-shadow:0 24px 50px -20px #000;display:flex;flex-direction:column;z-index:50}
.lang .menu a{display:flex;justify-content:space-between;gap:16px;padding:9px 12px;border-radius:9px;font-size:14.5px;text-decoration:none;color:var(--cream)}
.lang .menu a:hover{background:var(--night-3)}.lang .menu a small{color:var(--mute);text-transform:uppercase;font-size:12px}.lang .menu a[aria-current]{font-weight:600}
.hero{padding:190px 0 120px;position:relative;overflow:hidden}
.hero::before{content:"";position:absolute;inset:-20% -10% auto;height:120%;background:radial-gradient(600px 380px at 78% 30%,rgba(39,184,116,.16),transparent 70%),radial-gradient(520px 360px at 15% 80%,rgba(224,72,60,.10),transparent 70%);pointer-events:none}
.hero h1{font-family:var(--serif);font-weight:400;font-size:clamp(54px,8.2vw,118px);line-height:.95;letter-spacing:-.02em;margin-top:26px;max-width:980px}
.hero h1 em{font-style:italic;color:#fff}
.hero .lead{font-size:19.5px;color:var(--soft);max-width:640px;margin-top:28px}
.hero .ctas{display:flex;gap:12px;flex-wrap:wrap;margin-top:38px}
.lights{display:inline-flex;gap:7px;padding:8px 12px;border-radius:999px;background:#0a0908;border:1px solid var(--edge)}
.lights i{width:10px;height:10px;border-radius:50%;display:block;background:#3a2c27}
.lights i:nth-child(1){animation:l1 6s infinite}.lights i:nth-child(2){animation:l2 6s infinite}.lights i:nth-child(3){animation:l3 6s infinite}
@keyframes l1{0%,30%{background:#3a2c27}33%,63%{background:#3a2c27}66%,97%{background:var(--red);box-shadow:0 0 12px var(--red)}}
@keyframes l2{0%,30%{background:#3a2c27}33%,63%{background:var(--amber);box-shadow:0 0 12px var(--amber)}66%,100%{background:#3a2c27}}
@keyframes l3{0%,30%{background:var(--green);box-shadow:0 0 12px var(--green)}33%,100%{background:#3a2c27}}
section{padding:110px 0;position:relative}
.light-sec{background:var(--ivory);color:var(--ink)}.light-sec .eyebrow{color:var(--ink-3)}
h2.big{font-family:var(--serif);font-weight:400;font-size:clamp(40px,5.6vw,72px);line-height:1;letter-spacing:-.015em;margin-top:16px}
.app{display:grid;grid-template-columns:1.05fr .95fr;gap:0;border:1px solid var(--edge);border-radius:28px;overflow:hidden;background:linear-gradient(160deg,#1a1714,#100e0c);box-shadow:0 60px 120px -60px #000;margin-top:40px}
.app .info{padding:54px 52px}
.app .head{display:flex;align-items:center;gap:16px}
.app .head img{width:64px;height:64px;border-radius:16px}
.app .head h3{font-family:var(--serif);font-weight:400;font-size:46px;line-height:1}
.app .head p{color:var(--mute);font-size:14.5px;margin-top:4px}
.app .txt{color:var(--soft);font-size:17.5px;margin-top:26px}
.app ul{list-style:none;margin-top:26px;display:grid;gap:12px}
.app li{display:flex;gap:12px;align-items:flex-start;font-size:16px}
.app li b{flex:none;width:9px;height:9px;border-radius:50%;margin-top:8px}
.app .ctas{display:flex;gap:12px;flex-wrap:wrap;margin-top:34px}
.app .trial{color:var(--mute);font-size:13.5px;margin-top:14px}
.app .vis{position:relative;background:radial-gradient(420px 320px at 50% 45%,rgba(39,184,116,.14),transparent 70%),#0c0b0a;border-left:1px solid var(--edge);display:flex;align-items:center;justify-content:center;padding:50px 30px;min-height:460px}
.tl{width:118px;padding:16px 0;border-radius:40px;background:linear-gradient(180deg,#26221e,#141210);border:1px solid #34302b;display:flex;flex-direction:column;align-items:center;gap:14px;box-shadow:inset 0 2px 0 rgba(255,255,255,.05),0 40px 80px -30px #000}
.tl i{width:74px;height:74px;border-radius:50%;background:#2a201d;box-shadow:inset 0 6px 14px rgba(0,0,0,.6)}
.tl i:nth-child(1){animation:t1 7.5s infinite}.tl i:nth-child(2){animation:t2 7.5s infinite}.tl i:nth-child(3){animation:t3 7.5s infinite}
@keyframes t3{0%,30%{background:radial-gradient(circle at 40% 35%,#7ff0b8,#27B874 55%,#0e6b40);box-shadow:0 0 50px rgba(39,184,116,.75)}34%,100%{background:#1b2a22}}
@keyframes t2{0%,32%{background:#2d2617}34%,64%{background:radial-gradient(circle at 40% 35%,#ffd89a,#F2A23A 55%,#8a5410);box-shadow:0 0 50px rgba(242,162,58,.7)}67%,100%{background:#2d2617}}
@keyframes t1{0%,65%{background:#2e1b19}67%,97%{background:radial-gradient(circle at 40% 35%,#ff9a90,#E0483C 55%,#7a1d15);box-shadow:0 0 50px rgba(224,72,60,.7)}100%{background:#2e1b19}}
.chips{position:absolute;inset:0;pointer-events:none}
.chip{position:absolute;display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:14px;background:rgba(23,21,18,.92);border:1px solid var(--edge);font-size:13.5px;box-shadow:0 20px 40px -20px #000;opacity:0;animation:chip 7.5s infinite}
.chip b{width:9px;height:9px;border-radius:50%;flex:none}.chip strong{display:block;font-weight:600;font-size:14px}.chip span{color:var(--mute)}
.chip.c1{left:7%;top:18%;animation-delay:0s}.chip.c2{right:3%;top:58%;animation-delay:2.5s}.chip.c3{left:9%;bottom:14%;animation-delay:5s}
@keyframes chip{0%{opacity:0;transform:translateY(8px)}4%,30%{opacity:1;transform:none}34%,100%{opacity:0}}
.why{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:54px}
.why div{background:#fff;border:1px solid var(--line);border-radius:22px;padding:30px 26px}
.why h3{font-family:var(--serif);font-weight:400;font-size:27px;line-height:1.1}
.why p{color:var(--ink-2);font-size:15.5px;margin-top:12px}
.why .n{font-size:12.5px;letter-spacing:.18em;color:var(--ink-3);margin-bottom:18px}
.contact{text-align:center}
.contact p{color:var(--soft);font-size:18px;max-width:560px;margin:20px auto 0}
.contact .btn{margin-top:32px}
footer{border-top:1px solid var(--edge);padding:34px 0;color:var(--mute);font-size:14px}
footer .wrap{display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap}
footer .links{display:flex;gap:22px;flex-wrap:wrap}footer a{text-decoration:none}footer a:hover{color:var(--cream)}
.reveal{opacity:0;transform:translateY(18px);transition:opacity .9s ease,transform .9s ease}.reveal.in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.reveal{opacity:1;transform:none}}
@media (max-width:980px){.app{grid-template-columns:1fr}.app .vis{border-left:0;border-top:1px solid var(--edge);min-height:400px}.why{grid-template-columns:1fr 1fr}}
@media (max-width:640px){.wrap{padding:0 18px}.navlinks>a:not(.btn){display:none}.navlinks{gap:8px}.hero{padding:140px 0 80px}.hero .lead{font-size:17.5px}
 .app .info{padding:34px 24px}.app .head h3{font-size:38px}.why{grid-template-columns:1fr}section{padding:80px 0}.chip{font-size:12.5px}.chip.c2{right:4%}}
'''

GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>'
CUR = ' aria-current="page"'

REDIRECT = '''<script>
(function(){try{
  var KEY='kl-lang',S=['ro','es','fr','pl','ru'],saved=null;
  try{saved=localStorage.getItem(KEY)}catch(e){}
  if(saved){ if(saved!=='en'&&S.indexOf(saved)>-1) location.replace('/'+saved+'/'+location.hash); return; }
  var ls=(navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||'en']);
  for(var i=0;i<ls.length;i++){var l=String(ls[i]).slice(0,2).toLowerCase(); if(l==='en')return; if(S.indexOf(l)>-1){location.replace('/'+l+'/'+location.hash);return;}}
}catch(e){}})();
</script>'''

def page(c):
    t = {k: H.escape(v, quote=False) for k, v in T[c].items()}
    store = 'https://apps.shopify.com/semafor' + ('' if c == 'en' else f'?locale={c}')
    alts = ''.join(f'<link rel="alternate" hreflang="{x}" href="{url(home(x))}">\n' for x, _ in LANGS) + f'<link rel="alternate" hreflang="x-default" href="{url("/")}">\n'
    sw = ''.join(f'<a class="lang-a" href="{home(x)}" hreflang="{x}" lang="{x}" data-l="{x}"{CUR if x == c else ""}>{n}<small>{x}</small></a>' for x, n in LANGS)
    feats = ''.join(f'<li><b style="background:{col}"></b>{t[k]}</li>' for k, col in [('f1', 'var(--green)'), ('f2', 'var(--red)'), ('f3', 'var(--amber)'), ('f4', 'var(--cream)')])
    why = ''.join(f'<div class="reveal"><p class="n">0{i}</p><h3>{t[f"w{i}h"]}</h3><p>{t[f"w{i}p"]}</p></div>' for i in range(1, 5))
    return f'''<!doctype html>
<html lang="{c}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{t["title"]}</title>
<meta name="description" content="{H.escape(T[c]["desc"])}">
<meta property="og:title" content="{H.escape(T[c]["title"])}">
<meta property="og:description" content="{H.escape(T[c]["desc"])}">
<meta property="og:image" content="{SITE}/assets/kastel-icon-512.png">
{REDIRECT if c == 'en' else ''}
<link rel="canonical" href="{url(home(c))}">
{alts}<meta property="og:url" content="{url(home(c))}">
<meta property="og:locale" content="{OG[c]}">
<meta property="og:type" content="website">
<link rel="icon" type="image/png" href="/assets/kastel-favicon.png">
<link rel="apple-touch-icon" href="/assets/kastel-apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Cormorant+Garamond:ital,wght@0,500;1,500&family=Inter+Tight:wght@400;500;600&display=swap" rel="stylesheet">
<style>{CSS}</style>
</head>
<body>
<nav class="top" id="nav"><div class="wrap">
  <a class="logo" href="{home(c)}" aria-label="Kastel Labs"><img src="/assets/kastel-mark.svg" alt="" width="26" height="31"><span>Kastel Labs</span></a>
  <div class="navlinks">
    <a href="#apps">{t["nav_apps"]}</a><a href="#why">{t["nav_why"]}</a><a href="#contact">{t["nav_contact"]}</a>
    <details class="lang"><summary aria-label="{t["lang"]}">{GLOBE}{c.upper()}</summary><nav class="menu">{sw}</nav></details>
  </div>
</div></nav>

<header class="hero"><div class="wrap">
  <div style="display:flex;align-items:center;gap:14px"><span class="lights" aria-hidden="true"><i></i><i></i><i></i></span><span class="eyebrow">{t["eyebrow"]}</span></div>
  <h1>{t["h1a"]} <em>{t["h1b"]}</em></h1>
  <p class="lead">{t["lead"]}</p>
  <div class="ctas"><a class="btn btn-glow" href="{semafor(c)}">{t["cta1"]} →</a><a class="btn btn-line" href="#contact">{t["cta2"]}</a></div>
</div></header>

<section id="apps" style="padding-top:20px"><div class="wrap">
  <p class="eyebrow">{t["app_eyebrow"]}</p>
  <article class="app reveal">
    <div class="info">
      <div class="head"><img src="/assets/icon-512.png" alt="Semafor" width="64" height="64"><div><h3>Semafor</h3><p>{t["app_tag"]}</p></div></div>
      <p class="txt">{t["app_text"]}</p>
      <ul>{feats}</ul>
      <div class="ctas"><a class="btn btn-glow" href="{semafor(c)}">{t["app_more"]} →</a><a class="btn btn-line" href="{store}" target="_blank" rel="noopener">{t["app_install"]}</a></div>
      <p class="trial">{t["app_trial"]}</p>
    </div>
    <div class="vis" aria-hidden="true">
      <div class="tl"><i></i><i></i><i></i></div>
      <div class="chips">
        <div class="chip c1"><b style="background:var(--green)"></b><div><strong>#2481</strong><span>{t["o1"]}</span></div></div>
        <div class="chip c2"><b style="background:var(--amber)"></b><div><strong>#2482</strong><span>{t["o2"]}</span></div></div>
        <div class="chip c3"><b style="background:var(--red)"></b><div><strong>#2483</strong><span>{t["o3"]}</span></div></div>
      </div>
    </div>
  </article>
</div></section>

<section class="light-sec" id="why"><div class="wrap">
  <p class="eyebrow">{t["why_eyebrow"]}</p>
  <h2 class="big">{t["why_h"]}</h2>
  <div class="why">{why}</div>
</div></section>

<section class="contact" id="contact"><div class="wrap">
  <p class="eyebrow">{t["c_eyebrow"]}</p>
  <h2 class="big">{t["c_h"]}</h2>
  <p>{t["c_p"]}</p>
  <a class="btn btn-glow" href="mailto:{MAIL}">{t["c_btn"]}</a>
</div></section>

<footer><div class="wrap">
  <span style="display:flex;align-items:center;gap:10px"><img src="/assets/kastel-mark.svg" alt="" width="16" height="19">© 2026 Kastel Labs</span>
  <span class="links"><a href="mailto:{MAIL}">{MAIL}</a><a href="{semafor(c)}">Semafor</a><a href="{PRIVACY}" target="_blank" rel="noopener">{t["foot_privacy"]}</a><a href="{store}" target="_blank" rel="noopener">{t["foot_store"]}</a></span>
</div></footer>

<script>
(function(){{
  document.querySelectorAll('.lang-a').forEach(function(a){{a.addEventListener('click',function(){{try{{localStorage.setItem('kl-lang',a.getAttribute('data-l'))}}catch(e){{}}}})}});
  var nav=document.getElementById('nav');function s(){{nav.classList.toggle('scrolled',window.scrollY>20)}}s();window.addEventListener('scroll',s,{{passive:true}});
  var io=('IntersectionObserver' in window)?new IntersectionObserver(function(es){{es.forEach(function(e){{if(e.isIntersecting){{e.target.classList.add('in');io.unobserve(e.target)}}}})}},{{threshold:.12}}):null;
  document.querySelectorAll('.reveal').forEach(function(el){{io?io.observe(el):el.classList.add('in')}});
}})();
</script>
</body>
</html>
'''

for c, _ in LANGS:
    d = OUT if c == 'en' else f'{OUT}/{c}'
    os.makedirs(d, exist_ok=True)
    open(f'{d}/index.html', 'w').write(inject(page(c), c))

# sitemap: studio home + Semafor page, each with its 6 languages
sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
for fn in (home, semafor):
    for c, _ in LANGS:
        sm += f'  <url><loc>{url(fn(c))}</loc>' + ''.join(f'<xhtml:link rel="alternate" hreflang="{x}" href="{url(fn(x))}"/>' for x, _ in LANGS) + '</url>\n'
open(f'{OUT}/sitemap.xml', 'w').write(sm + '</urlset>\n')
open(f'{OUT}/robots.txt', 'w').write(f'User-agent: *\nAllow: /\nSitemap: {SITE}/sitemap.xml\n')
print('built home', [c for c, _ in LANGS])
