# "Your data in Semafor" — data & privacy page, /semafor/data/ and /semafor/{ro,es,fr,pl,ru}/data/.
# Called from build.py (after the Semafor page). Every statement here is checked against the app code:
#   prisma/schema.prisma, core/settings.ts (defaults), app/semafor/entries.server.ts (network),
#   app/routes/webhooks.compliance.tsx + core/redact.ts (GDPR), core/retention.ts (daily clean-up),
#   app/semafor/recovery.server.ts + app/routes/unsub.tsx (consent / unsubscribe), app/semafor/domains.server.ts (Resend EU).
# Keep it that way: change the text when the code changes.
import os, re, html as H
from analytics import inject, PRIVACY

MAIL = 'mihailiuc.co@gmail.com'
CUR = ' aria-current="page"'

# Link labels added to the Semafor page (footer + FAQ privacy answer); merged into build.py's dictionaries.
LINKS = {
 'en': {'Data & privacy': 'Data & privacy', 'Read how Semafor handles data →': 'Read how Semafor handles data →'},
 'ro': {'Data & privacy': 'Date și confidențialitate', 'Read how Semafor handles data →': 'Vezi cum lucrează Semafor cu datele →'},
 'es': {'Data & privacy': 'Datos y privacidad', 'Read how Semafor handles data →': 'Así trata Semafor los datos →'},
 'fr': {'Data & privacy': 'Données et confidentialité', 'Read how Semafor handles data →': 'Comment Semafor traite les données →'},
 'pl': {'Data & privacy': 'Dane i prywatność', 'Read how Semafor handles data →': 'Zobacz, jak Semafor obchodzi się z danymi →'},
 'bg': {'Data & privacy': 'Данни и поверителност', 'Read how Semafor handles data →': 'Вижте как Semafor работи с данните →'},
 'el': {'Data & privacy': 'Δεδομένα και απόρρητο', 'Read how Semafor handles data →': 'Δείτε πώς χειρίζεται το Semafor τα δεδομένα →'},
 'ru': {'Data & privacy': 'Данные и конфиденциальность', 'Read how Semafor handles data →': 'Как Semafor обращается с данными →'},
}

I = {  # stroke icons (24×24)
 'list': '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
 'light': '<rect x="8" y="2.5" width="8" height="19" rx="4"/><circle cx="12" cy="7" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="17" r="1.6"/>',
 'cart': '<path d="M3 4h2l2.4 11h11L21 7H6.2"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
 'pop': '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 8l9 6 9-6"/>',
 'send': '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
 'log': '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>',
 'server': '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
 'mail': '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 8l9 6 9-6"/>',
 'eu': '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/>',
 'key': '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
}
def ic(k): return f'<div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{I[k]}</svg></div>'

T = {}
T['en'] = dict(
 title='Your data in Semafor — data & privacy',
 desc='What Semafor stores, what the store network shares (and never shares), how a buyer is blocked and removed, consent for e-mails, deletion and where the data lives.',
 nav_back='Semafor', nav_policy='Privacy policy', install='Install',
 eyebrow='Data & privacy', h1='Your data in <em>Semafor</em>.',
 lead='What Semafor keeps, what it shares with other stores, and how you delete it — in plain words, written from the app’s code.',
 facts=['The network shares hashes — never names or addresses', 'Shopify deletion requests are applied automatically', 'Reminder e-mails only with consent, by default', 'Servers in the USA · company in the EU'],
 s1_eye='01 · What we store', s1_h='What Semafor keeps about your store.',
 s1_lead='Only what fraud checks and reminders need. Card and payment details never reach Semafor — Shopify does not give them to apps.',
 cards1=[
  ('list', 'Your blacklist', 'The people you add: e-mail, phone, name, address or device, the reason, your note and the order. It stays until you remove it.'),
  ('light', 'Order checks', 'For each new order: the light (green, yellow, red), what matched and what Semafor did — a tag, hidden payment, a cancellation. Deleted after 12 months.'),
  ('cart', 'Checkout steps', 'What the buyer types in checkout, the cart, a random device ID kept in their browser, a browser fingerprint (screen, language, time zone) and the IP. Deleted after 120 days.'),
  ('pop', 'Pop-up sign-ups', 'The e-mail a visitor leaves in your pop-up, with the device ID, language and page. The visitor is added to your Shopify customers.'),
  ('send', 'E-mails sent', 'Each reminder or welcome e-mail: recipient, subject, the e-mail as sent and whether it arrived — plus who unsubscribed.'),
  ('log', 'Activity log', 'Who added, changed or removed an entry, when settings changed, and the privacy requests that came from Shopify. Deleted after 12 months.'),
 ],
 s2_eye='02 · Store network', s2_h='What the network shares — and what it never does.',
 s2_lead='The network is on by default. Switch it off in Settings at any time: your store then stops sharing and stops seeing reports from others.',
 shared_h='Shared with the network', never_h='Never shared',
 shared=['One-way hashes of the buyer’s e-mail, phone or name + address — never the values themselves. They stay in Semafor’s database and in an app-only setting that your checkout reads',
         'The reason (refused parcel, chargeback, return fraud, threats) and the country',
         'A coded reference to your store, so each store counts only once',
         'The date — every report expires after 24 months'],
 never=['E-mails, phones, names or addresses in readable form',
        'Your notes, order numbers and order amounts',
        'A name alone, an address alone, or a device',
        'Which store reported a buyer — others see only how many stores, and why',
        'Returns without a valid reason, and “other” — they stay in your own list'],
 when=[('Chargebacks, return fraud and threats', 'are shared from the first report.'),
       ('A refused cash-on-delivery parcel', 'is shared only when the same buyer refuses a second time in your store.'),
       ('Remove an entry', '— or one detail of it — and your report is taken back from the network.'),
       ('Hiding payment for buyers reported by other stores', 'stays off until you turn it on.')],
 s3_eye='03 · Blocking', s3_h='How a buyer gets blocked — and how you undo it.',
 steps=[('Only on your terms', 'A buyer is affected only if they match your list — or, if you turn it on, enough reports from other stores.'),
        ('Your rule at checkout', 'Separately for red and yellow: just flag the order, hide cash on delivery only (card still works), or hide every payment method.'),
        ('No accusation', 'The buyer sees no message saying they are blocked — only fewer payment methods, or none.'),
        ('Undo in one click', 'Delete the entry under Blacklist: the checkout rule updates at once and your network reports are withdrawn.')],
 s4_eye='04 · Consent & e-mails', s4_h='E-mails only to people who said yes.',
 consent=[('Off until you switch them on.', 'Reminder e-mails start only when you enable them — and by default they go only to buyers who ticked e-mail marketing in checkout or are subscribed in Shopify.'),
          ('A pop-up sign-up counts as a yes', '— unless the person unsubscribed later. An earlier unsubscribe is never overwritten.'),
          ('One-click unsubscribe in every e-mail.', 'It marks the buyer as unsubscribed in Shopify, and Semafor never writes to them again for your store.'),
          ('Tell your customers.', 'The checkout pixel that recognises devices runs for fraud prevention, without waiting for the cookie banner — mention Semafor in your store’s privacy policy.')],
 s5_eye='05 · Deletion', s5_h='When data is deleted.',
 rows=[('You uninstall Semafor', 'Access ends at once. 48 hours later Shopify asks us to erase the store, and its data is deleted: blacklist, order checks, checkout steps, pop-up sign-ups, e-mails, logs, your reports in the network and your unsubscribe list.'),
       ('A buyer asks Shopify to erase their data', 'Applied automatically: their blacklist entry, checkout steps, pop-up sign-up, e-mails and the checks of their orders are deleted, together with your network reports about them. Anywhere else in your log, their e-mail or phone is replaced with “[redacted]”.'),
       ('A buyer asks for a copy of their data', 'Shopify forwards the request to us. We record it and answer within 30 days.'),
       ('Kept no longer than', 'Checkout steps: 120 days. Order checks and activity log: 12 months. Network reports: 24 months. Your blacklist: until you remove an entry. Clean-up runs every day.')],
 s6_eye='06 · Where data lives', s6_h='Where your data lives.',
 cards6=[('server', 'App and database', 'Railway, region US West (California, USA). All traffic to and from Semafor goes over HTTPS.'),
         ('mail', 'E-mails', 'Sent through Resend (USA). Stores that send from their own domain are set up in Resend’s EU region (Ireland).'),
         ('eu', 'The company', 'MIHAILIUC GROUP SRL, Bucharest, Romania — an EU company under the GDPR. You are the controller of your customers’ data; Semafor processes it for you.')],
 s7_h='Questions about your data?', s7_p='Write to us — you will get an answer from the people who build Semafor.',
 s7_policy='Read the privacy policy', foot_data='Data & privacy', foot_store='Shopify App Store',
)

T['ro'] = dict(
 title='Datele tale în Semafor — date și confidențialitate',
 desc='Ce păstrează Semafor, ce împarte rețeaua de magazine (și ce nu împarte niciodată), cum e blocat și deblocat un client, acordul pentru e-mailuri, ștergerea datelor și unde sunt găzduite.',
 nav_back='Semafor', nav_policy='Politica de confidențialitate', install='Instalează',
 eyebrow='Date și confidențialitate', h1='Datele tale în <em>Semafor</em>.',
 lead='Ce păstrează Semafor, ce împarte cu alte magazine și cum ștergi totul — pe înțelesul tuturor, scris pornind de la codul aplicației.',
 facts=['Rețeaua împarte doar hash-uri — niciodată nume sau adrese', 'Cererile de ștergere din Shopify se aplică automat', 'E-mailuri de reamintire doar cu acord, implicit', 'Servere în SUA · firmă din UE'],
 s1_eye='01 · Ce păstrăm', s1_h='Ce păstrează Semafor despre magazinul tău.',
 s1_lead='Doar ce e nevoie pentru verificări și reamintiri. Datele de card și de plată nu ajung niciodată la Semafor — Shopify nu le dă aplicațiilor.',
 cards1=[
  ('list', 'Lista ta neagră', 'Persoanele pe care le adaugi: e-mail, telefon, nume, adresă sau dispozitiv, motivul, nota ta și comanda. Rămân până le ștergi tu.'),
  ('light', 'Verificările comenzilor', 'Pentru fiecare comandă nouă: culoarea (verde, galben, roșu), ce s-a potrivit și ce a făcut Semafor — o etichetă, plată ascunsă, o anulare. Se șterg după 12 luni.'),
  ('cart', 'Pașii din checkout', 'Ce scrie clientul la checkout, coșul, un ID aleator al dispozitivului păstrat în browser, amprenta browserului (ecran, limbă, fus orar) și IP-ul. Se șterg după 120 de zile.'),
  ('pop', 'Abonări din pop-up', 'E-mailul lăsat de vizitator în pop-up, cu ID-ul dispozitivului, limba și pagina. Vizitatorul e adăugat la clienții tăi din Shopify.'),
  ('send', 'E-mailuri trimise', 'Fiecare reamintire sau e-mail de bun venit: destinatar, subiect, e-mailul exact cum a plecat și dacă a ajuns — plus cine s-a dezabonat.'),
  ('log', 'Istoric de activitate', 'Cine a adăugat, a modificat sau a șters o intrare, când s-au schimbat setările și cererile de confidențialitate venite din Shopify. Se șterge după 12 luni.'),
 ],
 s2_eye='02 · Rețeaua de magazine', s2_h='Ce împarte rețeaua — și ce nu împarte niciodată.',
 s2_lead='Rețeaua e pornită implicit. O poți opri oricând din Setări: magazinul tău nu mai împarte nimic și nici nu mai vede raportările altora.',
 shared_h='Se împarte cu rețeaua', never_h='Nu se împarte niciodată',
 shared=['Hash-uri ireversibile ale e-mailului, telefonului sau numelui + adresei clientului — niciodată valorile în sine. Stau în baza de date Semafor și într-o setare a aplicației pe care o citește doar checkout-ul tău',
         'Motivul (colet refuzat, chargeback, fraudă la retur, amenințări) și țara',
         'O referință codificată a magazinului tău, ca fiecare magazin să conteze o singură dată',
         'Data — fiecare raportare expiră după 24 de luni'],
 never=['E-mailuri, telefoane, nume sau adrese în formă lizibilă',
        'Notele tale, numerele și valorile comenzilor',
        'Doar un nume, doar o adresă sau un dispozitiv',
        'Ce magazin a raportat un client — ceilalți văd doar câte magazine și de ce',
        'Retururile fără motiv întemeiat și „altul” — rămân doar în lista ta'],
 when=[('Chargeback-urile, frauda la retur și amenințările', 'se împart de la prima raportare.'),
       ('Un colet ramburs refuzat', 'se împarte doar când același client refuză a doua oară în magazinul tău.'),
       ('Ștergi o intrare', '— sau doar un detaliu din ea — și raportarea ta e retrasă din rețea.'),
       ('Ascunderea plății pentru clienții raportați de alte magazine', 'rămâne oprită până o pornești tu.')],
 s3_eye='03 · Blocarea', s3_h='Cum ajunge un client blocat — și cum îl deblochezi.',
 steps=[('Doar după regulile tale', 'Un client e afectat doar dacă se potrivește cu lista ta — sau, dacă pornești opțiunea, cu destule raportări de la alte magazine.'),
        ('Regula ta la checkout', 'Separat pentru roșu și galben: doar marchezi comanda, ascunzi doar plata ramburs (cardul merge) sau ascunzi toate metodele de plată.'),
        ('Fără acuzații', 'Clientul nu vede niciun mesaj că e blocat — doar mai puține metode de plată sau niciuna.'),
        ('Anulezi dintr-un clic', 'Ștergi intrarea din Lista neagră: regula de la checkout se actualizează imediat, iar raportările tale din rețea sunt retrase.')],
 s4_eye='04 · Acord și e-mailuri', s4_h='E-mailuri doar pentru cei care au spus da.',
 consent=[('Oprite până le pornești.', 'Reamintirile pornesc doar când le activezi — și implicit ajung doar la clienții care au bifat marketingul pe e-mail la checkout sau sunt abonați în Shopify.'),
          ('Abonarea din pop-up înseamnă „da”', '— cu excepția celor care s-au dezabonat ulterior. O dezabonare mai veche nu e suprascrisă niciodată.'),
          ('Dezabonare dintr-un clic în fiecare e-mail.', 'Clientul e marcat ca dezabonat în Shopify, iar Semafor nu-i mai scrie niciodată din partea magazinului tău.'),
          ('Spune-le clienților.', 'Pixelul de checkout care recunoaște dispozitivele funcționează pentru prevenirea fraudei, fără să aștepte bannerul de cookie-uri — menționează Semafor în politica de confidențialitate a magazinului.')],
 s5_eye='05 · Ștergerea', s5_h='Când se șterg datele.',
 rows=[('Dezinstalezi Semafor', 'Accesul se oprește imediat. După 48 de ore Shopify ne cere să ștergem magazinul, iar datele lui sunt șterse: lista neagră, verificările, pașii din checkout, abonările din pop-up, e-mailurile, istoricul, raportările tale din rețea și lista de dezabonări.'),
       ('Un client cere în Shopify ștergerea datelor', 'Se aplică automat: intrarea lui din lista neagră, pașii din checkout, abonarea din pop-up, e-mailurile și verificările comenzilor lui sunt șterse, împreună cu raportările tale despre el din rețea. În restul istoricului, e-mailul sau telefonul lui e înlocuit cu „[redacted]”.'),
       ('Un client cere o copie a datelor', 'Shopify ne trimite cererea. O înregistrăm și răspundem în cel mult 30 de zile.'),
       ('Cât timp păstrăm', 'Pașii din checkout: 120 de zile. Verificările comenzilor și istoricul: 12 luni. Raportările din rețea: 24 de luni. Lista neagră: până ștergi intrarea. Curățenia rulează zilnic.')],
 s6_eye='06 · Unde stau datele', s6_h='Unde sunt găzduite datele.',
 cards6=[('server', 'Aplicația și baza de date', 'Railway, regiunea US West (California, SUA). Tot traficul către și dinspre Semafor trece prin HTTPS.'),
         ('mail', 'E-mailurile', 'Trimise prin Resend (SUA). Magazinele care trimit de pe domeniul propriu sunt configurate în regiunea UE a Resend (Irlanda).'),
         ('eu', 'Firma', 'MIHAILIUC GROUP SRL, București, România — firmă din UE, sub GDPR. Tu ești operatorul datelor clienților tăi; Semafor le prelucrează în numele tău.')],
 s7_h='Întrebări despre date?', s7_p='Scrie-ne — îți răspund chiar oamenii care fac Semafor.',
 s7_policy='Citește politica de confidențialitate', foot_data='Date și confidențialitate', foot_store='Shopify App Store',
)

T['es'] = dict(
 title='Tus datos en Semafor — datos y privacidad',
 desc='Qué guarda Semafor, qué comparte la red de tiendas (y qué no comparte nunca), cómo se bloquea y desbloquea a un comprador, el consentimiento para los e-mails, el borrado y dónde están los datos.',
 nav_back='Semafor', nav_policy='Política de privacidad', install='Instalar',
 eyebrow='Datos y privacidad', h1='Tus datos en <em>Semafor</em>.',
 lead='Qué guarda Semafor, qué comparte con otras tiendas y cómo lo borras — sin jerga, escrito a partir del código de la app.',
 facts=['La red comparte hashes, nunca nombres ni direcciones', 'Las solicitudes de borrado de Shopify se aplican solas', 'E-mails de recordatorio solo con consentimiento, por defecto', 'Servidores en EE. UU. · empresa en la UE'],
 s1_eye='01 · Qué guardamos', s1_h='Lo que Semafor guarda de tu tienda.',
 s1_lead='Solo lo que necesitan las comprobaciones y los recordatorios. Los datos de tarjeta y de pago nunca llegan a Semafor: Shopify no se los da a las apps.',
 cards1=[
  ('list', 'Tu lista negra', 'Las personas que añades: e-mail, teléfono, nombre, dirección o dispositivo, el motivo, tu nota y el pedido. Se quedan hasta que las borras.'),
  ('light', 'Revisión de pedidos', 'Para cada pedido nuevo: el color (verde, amarillo, rojo), qué coincidió y qué hizo Semafor: una etiqueta, ocultar el pago, una cancelación. Se borran a los 12 meses.'),
  ('cart', 'Pasos del checkout', 'Lo que el comprador escribe en el checkout, el carrito, un ID aleatorio del dispositivo guardado en su navegador, la huella del navegador (pantalla, idioma, zona horaria) y la IP. Se borran a los 120 días.'),
  ('pop', 'Altas desde el pop-up', 'El e-mail que deja un visitante en tu pop-up, con el ID del dispositivo, el idioma y la página. El visitante se añade a tus clientes de Shopify.'),
  ('send', 'E-mails enviados', 'Cada recordatorio o e-mail de bienvenida: destinatario, asunto, el e-mail tal como salió y si llegó, además de quién se dio de baja.'),
  ('log', 'Registro de actividad', 'Quién añadió, cambió o borró una entrada, cuándo cambiaron los ajustes y las solicitudes de privacidad llegadas desde Shopify. Se borra a los 12 meses.'),
 ],
 s2_eye='02 · Red de tiendas', s2_h='Qué comparte la red, y qué no comparte nunca.',
 s2_lead='La red viene activada. Puedes desactivarla en Ajustes cuando quieras: tu tienda deja de compartir y también deja de ver los avisos de las demás.',
 shared_h='Se comparte con la red', never_h='No se comparte nunca',
 shared=['Hashes irreversibles del e-mail, el teléfono o el nombre + dirección del comprador, nunca los datos en sí. Se quedan en la base de datos de Semafor y en un ajuste interno de la app que solo lee tu checkout',
         'El motivo (paquete rechazado, contracargo, fraude en devoluciones, amenazas) y el país',
         'Una referencia cifrada de tu tienda, para que cada tienda cuente una sola vez',
         'La fecha: cada aviso caduca a los 24 meses'],
 never=['E-mails, teléfonos, nombres o direcciones legibles',
        'Tus notas, números de pedido e importes',
        'Un nombre solo, una dirección sola o un dispositivo',
        'Qué tienda avisó de un comprador: las demás solo ven cuántas tiendas y por qué',
        'Las devoluciones sin motivo válido y «otro»: se quedan en tu lista'],
 when=[('Los contracargos, el fraude en devoluciones y las amenazas', 'se comparten desde el primer aviso.'),
       ('Un paquete contra reembolso rechazado', 'solo se comparte cuando el mismo comprador lo rechaza por segunda vez en tu tienda.'),
       ('Si borras una entrada', '(o uno de sus datos), tu aviso se retira de la red.'),
       ('Ocultar el pago a compradores señalados por otras tiendas', 'está desactivado hasta que tú lo actives.')],
 s3_eye='03 · Bloqueo', s3_h='Cómo se bloquea a un comprador, y cómo lo deshaces.',
 steps=[('Solo con tus reglas', 'Un comprador solo se ve afectado si coincide con tu lista o, si lo activas, con suficientes avisos de otras tiendas.'),
        ('Tu regla en el checkout', 'Por separado para rojo y amarillo: solo marcar el pedido, ocultar solo el contra reembolso (la tarjeta sigue disponible) u ocultar todos los métodos de pago.'),
        ('Sin acusaciones', 'El comprador no ve ningún mensaje de bloqueo: solo menos métodos de pago, o ninguno.'),
        ('Se deshace con un clic', 'Borra la entrada en Lista negra: la regla del checkout se actualiza al momento y tus avisos se retiran de la red.')],
 s4_eye='04 · Consentimiento y e-mails', s4_h='E-mails solo a quien ha dicho que sí.',
 consent=[('Desactivados hasta que los enciendas.', 'Los recordatorios solo empiezan cuando los activas y, por defecto, solo llegan a quien marcó el marketing por e-mail en el checkout o está suscrito en Shopify.'),
          ('Suscribirse en el pop-up cuenta como un sí', ', salvo que la persona se haya dado de baja después. Una baja anterior nunca se sobrescribe.'),
          ('Baja con un clic en cada e-mail.', 'El comprador queda dado de baja en Shopify y Semafor no vuelve a escribirle en nombre de tu tienda.'),
          ('Cuéntaselo a tus clientes.', 'El píxel del checkout que reconoce dispositivos funciona para prevenir el fraude, sin esperar al banner de cookies: menciona Semafor en la política de privacidad de tu tienda.')],
 s5_eye='05 · Borrado', s5_h='Cuándo se borran los datos.',
 rows=[('Desinstalas Semafor', 'El acceso termina al instante. 48 horas después Shopify nos pide borrar la tienda y sus datos se eliminan: lista negra, revisiones de pedidos, pasos del checkout, altas del pop-up, e-mails, registros, tus avisos en la red y tu lista de bajas.'),
       ('Un comprador pide a Shopify borrar sus datos', 'Se aplica solo: se borran su entrada en la lista negra, sus pasos del checkout, su alta en el pop-up, los e-mails y las revisiones de sus pedidos, junto con tus avisos sobre él en la red. En el resto del registro, su e-mail o teléfono se sustituye por «[redacted]».'),
       ('Un comprador pide una copia de sus datos', 'Shopify nos reenvía la solicitud. La registramos y respondemos en un plazo de 30 días.'),
       ('Cuánto se guardan', 'Pasos del checkout: 120 días. Revisiones de pedidos y registro: 12 meses. Avisos de la red: 24 meses. Tu lista negra: hasta que borres la entrada. La limpieza se hace a diario.')],
 s6_eye='06 · Dónde están', s6_h='Dónde están tus datos.',
 cards6=[('server', 'App y base de datos', 'Railway, región US West (California, EE. UU.). Todo el tráfico con Semafor va por HTTPS.'),
         ('mail', 'E-mails', 'Se envían con Resend (EE. UU.). Las tiendas que envían desde su propio dominio se configuran en la región europea de Resend (Irlanda).'),
         ('eu', 'La empresa', 'MIHAILIUC GROUP SRL, Bucarest, Rumanía: una empresa de la UE sujeta al RGPD. Tú eres el responsable de los datos de tus clientes; Semafor los trata por encargo tuyo.')],
 s7_h='¿Dudas sobre tus datos?', s7_p='Escríbenos: te responde el mismo equipo que hace Semafor.',
 s7_policy='Leer la política de privacidad', foot_data='Datos y privacidad', foot_store='Shopify App Store',
)

T['fr'] = dict(
 title='Vos données dans Semafor — données et confidentialité',
 desc='Ce que Semafor conserve, ce que le réseau de boutiques partage (et ne partage jamais), comment un acheteur est bloqué puis débloqué, le consentement aux e-mails, la suppression et l’hébergement des données.',
 nav_back='Semafor', nav_policy='Politique de confidentialité', install='Installer',
 eyebrow='Données et confidentialité', h1='Vos données dans <em>Semafor</em>.',
 lead='Ce que Semafor conserve, ce qu’il partage avec d’autres boutiques et comment tout supprimer — en clair, rédigé à partir du code de l’application.',
 facts=['Le réseau partage des empreintes, jamais de noms ni d’adresses', 'Les demandes de suppression Shopify sont appliquées automatiquement', 'E-mails de relance uniquement avec consentement, par défaut', 'Serveurs aux États-Unis · société dans l’UE'],
 s1_eye='01 · Ce que nous conservons', s1_h='Ce que Semafor conserve sur votre boutique.',
 s1_lead='Uniquement ce qu’exigent les vérifications et les relances. Les données de carte et de paiement n’arrivent jamais chez Semafor : Shopify ne les transmet pas aux applications.',
 cards1=[
  ('list', 'Votre liste noire', 'Les personnes que vous ajoutez : e-mail, téléphone, nom, adresse ou appareil, le motif, votre note et la commande. Elles y restent jusqu’à ce que vous les retiriez.'),
  ('light', 'Vérification des commandes', 'Pour chaque nouvelle commande : la couleur (vert, orange, rouge), ce qui correspond et ce que Semafor a fait — une étiquette, un paiement masqué, une annulation. Supprimées après 12 mois.'),
  ('cart', 'Étapes du checkout', 'Ce que l’acheteur saisit au checkout, le panier, un identifiant d’appareil aléatoire conservé dans son navigateur, une empreinte du navigateur (écran, langue, fuseau horaire) et l’adresse IP. Supprimées après 120 jours.'),
  ('pop', 'Inscriptions via le pop-up', 'L’e-mail laissé par un visiteur dans votre pop-up, avec l’identifiant d’appareil, la langue et la page. Le visiteur est ajouté à vos clients Shopify.'),
  ('send', 'E-mails envoyés', 'Chaque relance ou e-mail de bienvenue : destinataire, objet, l’e-mail tel qu’envoyé et sa remise — ainsi que la liste des désabonnés.'),
  ('log', 'Journal d’activité', 'Qui a ajouté, modifié ou supprimé une fiche, quand les réglages ont changé, et les demandes de confidentialité reçues de Shopify. Supprimé après 12 mois.'),
 ],
 s2_eye='02 · Réseau de boutiques', s2_h='Ce que le réseau partage — et ce qu’il ne partage jamais.',
 s2_lead='Le réseau est activé par défaut. Vous pouvez le couper à tout moment dans les Réglages : votre boutique cesse alors de partager et ne voit plus les signalements des autres.',
 shared_h='Partagé avec le réseau', never_h='Jamais partagé',
 shared=['Des empreintes à sens unique de l’e-mail, du téléphone ou du nom + adresse de l’acheteur — jamais les valeurs elles-mêmes. Elles restent dans la base de Semafor et dans un réglage interne à l’application que seul votre checkout lit',
         'Le motif (colis refusé, rétrofacturation, fraude au retour, menaces) et le pays',
         'Une référence codée de votre boutique, pour que chaque boutique ne compte qu’une fois',
         'La date — chaque signalement expire au bout de 24 mois'],
 never=['Des e-mails, téléphones, noms ou adresses lisibles',
        'Vos notes, numéros et montants de commande',
        'Un nom seul, une adresse seule ou un appareil',
        'Quelle boutique a signalé un acheteur — les autres voient seulement combien de boutiques, et pourquoi',
        'Les retours sans motif valable et « autre » — ils restent dans votre propre liste'],
 when=[('Les rétrofacturations, la fraude au retour et les menaces', 'sont partagées dès le premier signalement.'),
       ('Un colis contre remboursement refusé', 'n’est partagé que lorsque le même acheteur refuse une deuxième fois dans votre boutique.'),
       ('Supprimez une fiche', '— ou l’un de ses éléments — et votre signalement est retiré du réseau.'),
       ('Masquer le paiement aux acheteurs signalés par d’autres boutiques', 'reste désactivé tant que vous ne l’activez pas.')],
 s3_eye='03 · Blocage', s3_h='Comment un acheteur est bloqué — et comment annuler.',
 steps=[('Selon vos règles uniquement', 'Un acheteur n’est concerné que s’il figure dans votre liste — ou, si vous l’activez, s’il a assez de signalements d’autres boutiques.'),
        ('Votre règle au checkout', 'Séparément pour le rouge et l’orange : simplement signaler la commande, masquer seulement le paiement à la livraison (la carte reste possible) ou masquer tous les moyens de paiement.'),
        ('Aucune accusation', 'L’acheteur ne voit aucun message indiquant qu’il est bloqué — seulement moins de moyens de paiement, ou aucun.'),
        ('Annulable en un clic', 'Supprimez la fiche dans Liste noire : la règle du checkout est mise à jour aussitôt et vos signalements sont retirés du réseau.')],
 s4_eye='04 · Consentement et e-mails', s4_h='Des e-mails seulement à ceux qui ont dit oui.',
 consent=[('Désactivés tant que vous ne les activez pas.', 'Les relances ne démarrent que si vous les activez — et, par défaut, elles ne partent qu’aux acheteurs qui ont coché le marketing par e-mail au checkout ou sont abonnés dans Shopify.'),
          ('S’inscrire via le pop-up vaut accord', ', sauf si la personne s’est désabonnée depuis. Un désabonnement antérieur n’est jamais écrasé.'),
          ('Désabonnement en un clic dans chaque e-mail.', 'L’acheteur est marqué comme désabonné dans Shopify et Semafor ne lui écrit plus jamais au nom de votre boutique.'),
          ('Informez vos clients.', 'Le pixel du checkout qui reconnaît les appareils sert à la prévention de la fraude et fonctionne sans attendre le bandeau cookies — mentionnez Semafor dans la politique de confidentialité de votre boutique.')],
 s5_eye='05 · Suppression', s5_h='Quand les données sont supprimées.',
 rows=[('Vous désinstallez Semafor', 'L’accès s’arrête immédiatement. 48 heures plus tard, Shopify nous demande d’effacer la boutique et ses données sont supprimées : liste noire, vérifications, étapes du checkout, inscriptions du pop-up, e-mails, journaux, vos signalements dans le réseau et votre liste de désabonnés.'),
       ('Un acheteur demande à Shopify d’effacer ses données', 'Appliqué automatiquement : sa fiche en liste noire, ses étapes du checkout, son inscription au pop-up, les e-mails et les vérifications de ses commandes sont supprimés, ainsi que vos signalements le concernant dans le réseau. Ailleurs dans le journal, son e-mail ou son téléphone est remplacé par « [redacted] ».'),
       ('Un acheteur demande une copie de ses données', 'Shopify nous transmet la demande. Nous l’enregistrons et y répondons sous 30 jours.'),
       ('Durées de conservation', 'Étapes du checkout : 120 jours. Vérifications des commandes et journal : 12 mois. Signalements du réseau : 24 mois. Votre liste noire : jusqu’à ce que vous supprimiez la fiche. Le nettoyage a lieu chaque jour.')],
 s6_eye='06 · Hébergement', s6_h='Où sont vos données.',
 cards6=[('server', 'Application et base de données', 'Railway, région US West (Californie, États-Unis). Tous les échanges avec Semafor passent par HTTPS.'),
         ('mail', 'E-mails', 'Envoyés via Resend (États-Unis). Les boutiques qui envoient depuis leur propre domaine sont configurées dans la région européenne de Resend (Irlande).'),
         ('eu', 'La société', 'MIHAILIUC GROUP SRL, Bucarest, Roumanie — une société de l’UE soumise au RGPD. Vous êtes responsable du traitement des données de vos clients ; Semafor les traite pour votre compte.')],
 s7_h='Une question sur vos données ?', s7_p='Écrivez-nous — ce sont les personnes qui développent Semafor qui vous répondent.',
 s7_policy='Lire la politique de confidentialité', foot_data='Données et confidentialité', foot_store='Shopify App Store',
)

T['pl'] = dict(
 title='Twoje dane w Semafor — dane i prywatność',
 desc='Co przechowuje Semafor, co udostępnia sieć sklepów (a czego nigdy), jak kupujący zostaje zablokowany i odblokowany, zgody na e-maile, usuwanie danych i gdzie są przechowywane.',
 nav_back='Semafor', nav_policy='Polityka prywatności', install='Zainstaluj',
 eyebrow='Dane i prywatność', h1='Twoje dane w <em>Semafor</em>.',
 lead='Co przechowuje Semafor, czym dzieli się z innymi sklepami i jak wszystko usunąć — prostym językiem, na podstawie kodu aplikacji.',
 facts=['Sieć wymienia tylko skróty (hashe) — nigdy nazwiska ani adresy', 'Żądania usunięcia danych z Shopify są realizowane automatycznie', 'Przypomnienia e-mail domyślnie tylko za zgodą', 'Serwery w USA · firma w UE'],
 s1_eye='01 · Co przechowujemy', s1_h='Co Semafor przechowuje o Twoim sklepie.',
 s1_lead='Tylko to, czego potrzebują weryfikacja zamówień i przypomnienia. Dane kart i płatności nigdy nie trafiają do Semafor — Shopify nie przekazuje ich aplikacjom.',
 cards1=[
  ('list', 'Twoja czarna lista', 'Osoby, które dodajesz: e-mail, telefon, imię i nazwisko, adres lub urządzenie, powód, Twoja notatka i zamówienie. Zostają, dopóki ich nie usuniesz.'),
  ('light', 'Weryfikacja zamówień', 'Dla każdego nowego zamówienia: kolor (zielony, żółty, czerwony), co się zgadza i co zrobił Semafor — tag, ukryta płatność, anulowanie. Usuwane po 12 miesiącach.'),
  ('cart', 'Kroki w checkoucie', 'To, co kupujący wpisuje w checkoucie, koszyk, losowy identyfikator urządzenia zapisany w przeglądarce, odcisk przeglądarki (ekran, język, strefa czasowa) i adres IP. Usuwane po 120 dniach.'),
  ('pop', 'Zapisy z pop-upu', 'E-mail zostawiony w pop-upie, z identyfikatorem urządzenia, językiem i stroną. Osoba zostaje dodana do Twoich klientów w Shopify.'),
  ('send', 'Wysłane e-maile', 'Każde przypomnienie i e-mail powitalny: odbiorca, temat, treść dokładnie w wysłanej postaci i czy dotarła — oraz lista osób wypisanych.'),
  ('log', 'Dziennik zmian', 'Kto dodał, zmienił lub usunął wpis, kiedy zmieniono ustawienia oraz żądania dotyczące prywatności przekazane przez Shopify. Usuwany po 12 miesiącach.'),
 ],
 s2_eye='02 · Sieć sklepów', s2_h='Czym dzieli się sieć — i czym nigdy.',
 s2_lead='Sieć jest domyślnie włączona. W każdej chwili wyłączysz ją w Ustawieniach: Twój sklep przestaje wtedy udostępniać zgłoszenia i nie widzi już zgłoszeń innych.',
 shared_h='Trafia do sieci', never_h='Nigdy nie trafia do sieci',
 shared=['Jednokierunkowe skróty (hashe) e-maila, telefonu albo imienia i nazwiska + adresu kupującego — nigdy same dane. Zostają w bazie Semafor i w wewnętrznym ustawieniu aplikacji, które czyta tylko Twój checkout',
         'Powód (nieodebrana paczka, chargeback, oszustwo przy zwrocie, groźby) i kraj',
         'Zakodowany identyfikator Twojego sklepu, żeby każdy sklep liczył się tylko raz',
         'Data — każde zgłoszenie wygasa po 24 miesiącach'],
 never=['E-maile, telefony, nazwiska czy adresy w czytelnej postaci',
        'Twoje notatki, numery i kwoty zamówień',
        'Samo nazwisko, sam adres ani urządzenie',
        'Który sklep zgłosił kupującego — inni widzą tylko, ile sklepów i z jakiego powodu',
        'Zwroty bez uzasadnionego powodu i „inne” — zostają na Twojej liście'],
 when=[('Chargebacki, oszustwa przy zwrotach i groźby', 'trafiają do sieci od pierwszego zgłoszenia.'),
       ('Nieodebrana paczka za pobraniem', 'trafia do sieci dopiero wtedy, gdy ten sam kupujący nie odbierze paczki po raz drugi w Twoim sklepie.'),
       ('Usuń wpis', '— albo jedną jego daną — a Twoje zgłoszenie zostanie wycofane z sieci.'),
       ('Ukrywanie płatności przed kupującymi zgłoszonymi przez inne sklepy', 'jest wyłączone, dopóki go nie włączysz.')],
 s3_eye='03 · Blokowanie', s3_h='Jak kupujący zostaje zablokowany — i jak to cofnąć.',
 steps=[('Tylko na Twoich zasadach', 'Blokada dotyczy kupującego tylko wtedy, gdy pasuje do Twojej listy — albo, jeśli to włączysz, ma dość zgłoszeń z innych sklepów.'),
        ('Twoja reguła w checkoucie', 'Osobno dla czerwonego i żółtego: tylko oznacz zamówienie, ukryj wyłącznie płatność za pobraniem (karta działa) albo ukryj wszystkie metody płatności.'),
        ('Bez oskarżeń', 'Kupujący nie widzi komunikatu o blokadzie — tylko mniej metod płatności albo żadnej.'),
        ('Cofasz jednym kliknięciem', 'Usuń wpis w Czarnej liście: reguła w checkoucie zmienia się od razu, a Twoje zgłoszenia znikają z sieci.')],
 s4_eye='04 · Zgody i e-maile', s4_h='E-maile tylko do osób, które się zgodziły.',
 consent=[('Wyłączone, dopóki ich nie włączysz.', 'Przypomnienia ruszają dopiero po włączeniu — i domyślnie trafiają tylko do kupujących, którzy zaznaczyli zgodę na marketing e-mailowy w checkoucie albo są zapisani w Shopify.'),
          ('Zapis w pop-upie oznacza zgodę', '— chyba że ktoś później się wypisał. Wcześniejsze wypisanie nigdy nie jest nadpisywane.'),
          ('Wypisanie jednym kliknięciem w każdym e-mailu.', 'Kupujący zostaje oznaczony w Shopify jako wypisany, a Semafor już nigdy nie napisze do niego w imieniu Twojego sklepu.'),
          ('Poinformuj klientów.', 'Piksel w checkoucie, który rozpoznaje urządzenia, służy zapobieganiu oszustwom i działa bez czekania na baner cookies — wspomnij o Semafor w polityce prywatności swojego sklepu.')],
 s5_eye='05 · Usuwanie', s5_h='Kiedy dane są usuwane.',
 rows=[('Odinstalowujesz Semafor', 'Dostęp kończy się od razu. Po 48 godzinach Shopify prosi nas o usunięcie sklepu i jego dane są kasowane: czarna lista, weryfikacje, kroki w checkoucie, zapisy z pop-upu, e-maile, dzienniki, Twoje zgłoszenia w sieci i lista wypisanych.'),
       ('Kupujący prosi Shopify o usunięcie danych', 'Dzieje się to automatycznie: jego wpis na czarnej liście, kroki w checkoucie, zapis z pop-upu, e-maile i weryfikacje jego zamówień są usuwane razem z Twoimi zgłoszeniami o nim w sieci. W pozostałej części dziennika jego e-mail lub telefon zastępuje „[redacted]”.'),
       ('Kupujący prosi o kopię swoich danych', 'Shopify przekazuje nam żądanie. Rejestrujemy je i odpowiadamy w ciągu 30 dni.'),
       ('Jak długo przechowujemy', 'Kroki w checkoucie: 120 dni. Weryfikacje zamówień i dziennik: 12 miesięcy. Zgłoszenia w sieci: 24 miesiące. Czarna lista: do czasu usunięcia wpisu. Porządki odbywają się codziennie.')],
 s6_eye='06 · Gdzie są dane', s6_h='Gdzie przechowujemy dane.',
 cards6=[('server', 'Aplikacja i baza danych', 'Railway, region US West (Kalifornia, USA). Cała komunikacja z Semafor odbywa się przez HTTPS.'),
         ('mail', 'E-maile', 'Wysyłane przez Resend (USA). Sklepy wysyłające z własnej domeny są skonfigurowane w regionie UE Resend (Irlandia).'),
         ('eu', 'Firma', 'MIHAILIUC GROUP SRL, Bukareszt, Rumunia — firma z UE, podlegająca RODO. Ty jesteś administratorem danych swoich klientów; Semafor przetwarza je w Twoim imieniu.')],
 s7_h='Pytania o dane?', s7_p='Napisz do nas — odpowiedzą Ci ludzie, którzy tworzą Semafor.',
 s7_policy='Przeczytaj politykę prywatności', foot_data='Dane i prywatność', foot_store='Shopify App Store',
)

T['ru'] = dict(
 title='Ваши данные в Semafor — данные и конфиденциальность',
 desc='Что хранит Semafor, чем делится сеть магазинов (и чем никогда), как покупателя блокируют и разблокируют, согласие на письма, удаление данных и где они хранятся.',
 nav_back='Semafor', nav_policy='Политика конфиденциальности', install='Установить',
 eyebrow='Данные и конфиденциальность', h1='Ваши данные в <em>Semafor</em>.',
 lead='Что Semafor хранит, чем делится с другими магазинами и как всё удалить — простыми словами, по коду самого приложения.',
 facts=['Сеть обменивается только хешами — никогда именами или адресами', 'Запросы Shopify на удаление выполняются автоматически', 'Письма-напоминания по умолчанию — только с согласия', 'Серверы в США · компания в ЕС'],
 s1_eye='01 · Что мы храним', s1_h='Что Semafor хранит о вашем магазине.',
 s1_lead='Только то, что нужно для проверок и напоминаний. Данные карт и платежей в Semafor не попадают — Shopify не передаёт их приложениям.',
 cards1=[
  ('list', 'Ваш чёрный список', 'Люди, которых вы добавили: e-mail, телефон, имя, адрес или устройство, причина, ваша заметка и заказ. Хранятся, пока вы их не удалите.'),
  ('light', 'Проверки заказов', 'По каждому новому заказу: цвет (зелёный, жёлтый, красный), что совпало и что сделал Semafor — тег, скрытая оплата, отмена. Удаляются через 12 месяцев.'),
  ('cart', 'Шаги оформления', 'Что покупатель вводит при оформлении, корзина, случайный ID устройства в его браузере, отпечаток браузера (экран, язык, часовой пояс) и IP-адрес. Удаляются через 120 дней.'),
  ('pop', 'Подписки из поп-апа', 'E-mail, оставленный в поп-апе, вместе с ID устройства, языком и страницей. Посетитель добавляется в ваших клиентов в Shopify.'),
  ('send', 'Отправленные письма', 'Каждое напоминание и приветственное письмо: получатель, тема, письмо в том виде, как ушло, и дошло ли оно, — а также список отписавшихся.'),
  ('log', 'Журнал действий', 'Кто добавил, изменил или удалил запись, когда менялись настройки и какие запросы о данных пришли от Shopify. Удаляется через 12 месяцев.'),
 ],
 s2_eye='02 · Сеть магазинов', s2_h='Чем делится сеть — и чем никогда.',
 s2_lead='Сеть включена по умолчанию. Её можно выключить в Настройках в любой момент: тогда ваш магазин перестаёт делиться отметками и перестаёт видеть отметки других.',
 shared_h='Уходит в сеть', never_h='Не уходит никогда',
 shared=['Необратимые хеши e-mail, телефона или имени + адреса покупателя — никогда сами значения. Они хранятся в базе Semafor и во внутренней настройке приложения, которую читает только ваше оформление заказа',
         'Причина (отказ от посылки, чарджбэк, мошенничество с возвратом, угрозы) и страна',
         'Закодированная ссылка на ваш магазин — чтобы каждый магазин учитывался один раз',
         'Дата — каждая отметка истекает через 24 месяца'],
 never=['E-mail, телефоны, имена или адреса в читаемом виде',
        'Ваши заметки, номера и суммы заказов',
        'Одно только имя, один только адрес или устройство',
        'Какой магазин отметил покупателя — другие видят только, сколько магазинов и почему',
        'Возвраты без уважительной причины и «другое» — они остаются только в вашем списке'],
 when=[('Чарджбэки, мошенничество с возвратами и угрозы', 'уходят в сеть с первой отметки.'),
       ('Отказ от посылки с наложенным платежом', 'уходит в сеть только когда тот же покупатель отказывается второй раз в вашем магазине.'),
       ('Удалите запись', '— или одно её значение — и ваша отметка отзывается из сети.'),
       ('Скрытие оплаты для покупателей, отмеченных другими магазинами,', 'выключено, пока вы сами его не включите.')],
 s3_eye='03 · Блокировка', s3_h='Как покупатель попадает под блокировку — и как её снять.',
 steps=[('Только по вашим правилам', 'Покупателя это касается, только если он совпал с вашим списком — или, если вы это включили, набрал достаточно отметок других магазинов.'),
        ('Ваше правило на оформлении', 'Отдельно для красного и жёлтого: только пометить заказ, скрыть только наложенный платёж (карта работает) или скрыть все способы оплаты.'),
        ('Без обвинений', 'Покупатель не видит сообщения о блокировке — только меньше способов оплаты или ни одного.'),
        ('Снимается в один клик', 'Удалите запись в Чёрном списке: правило на оформлении обновится сразу, а ваши отметки уйдут из сети.')],
 s4_eye='04 · Согласие и письма', s4_h='Письма — только тем, кто согласился.',
 consent=[('Выключены, пока вы их не включите.', 'Напоминания начинаются, только когда вы их включили, и по умолчанию уходят лишь тем, кто отметил согласие на рассылку при оформлении или подписан в Shopify.'),
          ('Подписка в поп-апе — это согласие', ', если человек потом не отписался. Ранее оформленная отписка никогда не перезаписывается.'),
          ('Отписка в один клик в каждом письме.', 'Покупатель помечается в Shopify как отписавшийся, и Semafor больше никогда не пишет ему от имени вашего магазина.'),
          ('Предупредите покупателей.', 'Пиксель на оформлении, который узнаёт устройства, работает для защиты от мошенничества и не ждёт cookie-баннера — упомяните Semafor в политике конфиденциальности магазина.')],
 s5_eye='05 · Удаление', s5_h='Когда данные удаляются.',
 rows=[('Вы удаляете Semafor', 'Доступ прекращается сразу. Через 48 часов Shopify просит нас стереть магазин, и его данные удаляются: чёрный список, проверки заказов, шаги оформления, подписки из поп-апа, письма, журналы, ваши отметки в сети и список отписавшихся.'),
       ('Покупатель просит Shopify удалить его данные', 'Выполняется автоматически: его запись в чёрном списке, шаги оформления, подписка из поп-апа, письма и проверки его заказов удаляются вместе с вашими отметками о нём в сети. В остальном журнале его e-mail или телефон заменяется на «[redacted]».'),
       ('Покупатель просит копию своих данных', 'Shopify пересылает запрос нам. Мы его фиксируем и отвечаем в течение 30 дней.'),
       ('Сроки хранения', 'Шаги оформления: 120 дней. Проверки заказов и журнал: 12 месяцев. Отметки в сети: 24 месяца. Чёрный список: пока вы не удалите запись. Очистка идёт ежедневно.')],
 s6_eye='06 · Где хранятся данные', s6_h='Где хранятся ваши данные.',
 cards6=[('server', 'Приложение и база данных', 'Railway, регион US West (Калифорния, США). Весь обмен данными с Semafor идёт по HTTPS.'),
         ('mail', 'Письма', 'Отправляются через Resend (США). Магазины, которые шлют письма со своего домена, настраиваются в европейском регионе Resend (Ирландия).'),
         ('eu', 'Компания', 'MIHAILIUC GROUP SRL, Бухарест, Румыния — компания из ЕС, работающая по GDPR. Вы — оператор данных своих покупателей; Semafor обрабатывает их по вашему поручению.')],
 s7_h='Вопросы о данных?', s7_p='Напишите нам — ответят люди, которые делают Semafor.',
 s7_policy='Читать политику конфиденциальности', foot_data='Данные и конфиденциальность', foot_store='Shopify App Store',
)

PAGE_CSS = '''
.dhero{padding:150px 0 90px;background:radial-gradient(1000px 600px at 80% 20%,#1E1B17 0%,var(--night) 62%);overflow:hidden}
.dhero h1{font-size:clamp(50px,7.4vw,104px);line-height:.96;max-width:12ch;margin-top:22px}
.dhero h1 em{font-style:italic;color:#D8CFC1}
.dhero .lead{max-width:620px}
.facts{list-style:none;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:46px}
.facts li{display:flex;gap:12px;align-items:flex-start;padding:16px 18px;border:1px solid var(--edge);border-radius:16px;background:rgba(255,255,255,.025);font-size:14.5px;line-height:1.45;color:#D9D2C6}
.facts li::before{content:"";flex:none;width:10px;height:10px;border-radius:50%;margin-top:5px;background:var(--green);box-shadow:0 0 10px var(--green)}
.sh{max-width:760px}
.sh h2{margin-top:18px}
.cards3.six{margin-top:44px}
.duo{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:44px}
.duo .panel h3{font-size:15px;font-weight:600;letter-spacing:.02em;display:flex;align-items:center;gap:10px;padding-bottom:16px;border-bottom:1px solid var(--edge)}
.duo .panel h3 i{width:10px;height:10px;border-radius:50%;background:var(--c);box-shadow:0 0 10px var(--c)}
.duo ul{list-style:none;display:flex;flex-direction:column}
.duo li{padding:14px 0;border-bottom:1px solid var(--edge);color:#D9D2C6;font-size:15.5px;display:flex;gap:12px}
.duo li:last-child{border-bottom:0;padding-bottom:0}
.duo li::before{flex:none;width:18px;font-weight:600}
.duo .yes li::before{content:"+";color:var(--green)}
.duo .no li::before{content:"×";color:var(--red)}
.when{margin-top:34px}
.steps4{list-style:none;display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:44px;counter-reset:s}
.steps4 li{counter-increment:s;border-radius:20px;background:var(--paper);border:1px solid var(--line);padding:24px}
.steps4 li::before{content:counter(s,decimal-leading-zero);font-family:var(--serif);font-size:34px;line-height:1;color:var(--ink-3)}
.steps4 h5{font-size:17px;font-weight:600;margin:14px 0 6px}
.steps4 p{color:var(--ink-2);font-size:15px}
.rows{margin-top:40px;border-top:1px solid var(--line)}
.rows > div{display:grid;grid-template-columns:.8fr 1.6fr;gap:28px;padding:24px 0;border-bottom:1px solid var(--line)}
.rows h5{font-size:17px;font-weight:600}
.rows p{color:var(--ink-2);font-size:15.5px}
.where .c3{background:var(--night-2);border-color:var(--edge)}
.where .c3 h5{color:var(--cream)}
.where .c3 p{color:var(--soft)}
.where .c3 .ic{background:var(--night-3);border:1px solid var(--edge)}
.where .c3 .ic svg{stroke:var(--cream)}
.final p a{color:var(--cream)}
@media (max-width:1000px){.facts{grid-template-columns:1fr 1fr}.duo,.steps4{grid-template-columns:1fr 1fr}}
@media (max-width:600px){.dhero{padding:118px 0 70px}.facts,.duo,.steps4{grid-template-columns:1fr}.rows > div{grid-template-columns:1fr;gap:6px}.duo .panel{padding:22px}}
'''

def data_path(code): return '/semafor/data/' if code == 'en' else f'/semafor/{code}/data/'
def sem_path(code): return '/semafor/' if code == 'en' else f'/semafor/{code}/'
def home_path(code): return '/' if code == 'en' else f'/{code}/'

REDIRECT = '''<script>
(function(){try{
  var KEY='kl-lang',S=['ro','es','fr','pl','ru'],saved=null;
  try{saved=localStorage.getItem(KEY)}catch(e){}
  if(saved){ if(saved!=='en'&&S.indexOf(saved)>-1) location.replace('/semafor/'+saved+'/data/'+location.hash); return; }
  var ls=(navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||'en']);
  for(var i=0;i<ls.length;i++){var l=String(ls[i]).slice(0,2).toLowerCase(); if(l==='en')return; if(S.indexOf(l)>-1){location.replace('/semafor/'+l+'/data/'+location.hash);return;}}
}catch(e){}})();
</script>'''

def build_data(tpl, sw_css, save_js, langs, og, site, out):
    base_css = re.search(r'<style>(.*?)</style>', tpl, re.S).group(1)
    globe = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>'
    for code, _, _ in langs:
        t = T[code]
        e = lambda s: H.escape(s, quote=False)
        store = 'https://apps.shopify.com/semafor' + ('' if code == 'en' else f'?locale={code}')
        items = ''.join(f'<a class="lang-a" href="{data_path(c)}" hreflang="{c}" lang="{c}" data-l="{c}"{CUR if c == code else ""}>{n}<small>{c}</small></a>' for c, n, _ in langs)
        sw = f'<details class="lang"><summary aria-label="Language">{globe}{code.upper()}</summary><nav class="menu">{items}</nav></details>'
        alts = ''.join(f'<link rel="alternate" hreflang="{c}" href="{site}{data_path(c)}">\n' for c, _, _ in langs) + f'<link rel="alternate" hreflang="x-default" href="{site}{data_path("en")}">\n'
        cards = lambda lst: ''.join(f'<div class="c3 reveal">{ic(k)}<h5>{e(h)}</h5><p>{e(p)}</p></div>' for k, h, p in lst)
        h = f'''<!doctype html>
<html lang="{code}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(t["title"])}</title>
<meta name="description" content="{H.escape(t["desc"])}">
<meta property="og:title" content="{H.escape(t["title"])}">
<meta property="og:description" content="{H.escape(t["desc"])}">
<meta property="og:image" content="https://www.kastellabs.com/assets/icon-512.png">
{REDIRECT if code == 'en' else ''}
<link rel="canonical" href="{site}{data_path(code)}">
{alts}<meta property="og:url" content="{site}{data_path(code)}">
<meta property="og:locale" content="{og[code]}">
<meta property="og:type" content="website">
<link rel="icon" type="image/png" href="/assets/favicon.png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Cormorant+Garamond:ital,wght@0,500;1,500&family=Inter+Tight:wght@400;500;600&display=swap" rel="stylesheet">
<style>{base_css}{sw_css}{PAGE_CSS}</style>
</head>
<body>

<nav class="top" id="nav">
  <div class="wrap">
    <div class="brandwrap"><a href="{home_path(code)}" class="kl-mark" data-home><img src="/assets/kastel-mark.svg" alt="" width="15" height="18">Kastel Labs</a><span class="kl-sep" aria-hidden="true">/</span><a href="{sem_path(code)}" class="brand"><img src="/assets/icon-512.png" alt="" width="30" height="30">Semafor</a></div>
    <div class="navlinks">
      <a href="{PRIVACY}" target="_blank" rel="noopener">{e(t["nav_policy"])}</a>
      {sw}
      <a class="btn btn-glow btn-sm" href="{store}" target="_blank" rel="noopener">{e(t["install"])}</a>
    </div>
  </div>
</nav>

<header class="dhero grain" id="top">
  <div class="wrap">
    <div class="eyebrow reveal">{e(t["eyebrow"])}</div>
    <h1 class="serif reveal">{t["h1"]}</h1>
    <p class="lead reveal">{e(t["lead"])}</p>
    <ul class="facts reveal">{''.join(f'<li>{e(x)}</li>' for x in t["facts"])}</ul>
  </div>
</header>

<section class="light-sec" id="store">
  <div class="wrap">
    <div class="sh"><div class="eyebrow reveal">{e(t["s1_eye"])}</div><h2 class="big serif reveal">{e(t["s1_h"])}</h2><p class="lead reveal">{e(t["s1_lead"])}</p></div>
    <div class="cards3 six">{cards(t["cards1"])}</div>
  </div>
</section>

<section id="network">
  <div class="wrap">
    <div class="sh"><div class="eyebrow reveal">{e(t["s2_eye"])}</div><h2 class="big serif reveal">{e(t["s2_h"])}</h2><p class="lead reveal">{e(t["s2_lead"])}</p></div>
    <div class="duo">
      <div class="panel yes reveal"><h3><i style="--c:var(--green)"></i>{e(t["shared_h"])}</h3><ul>{''.join(f'<li>{e(x)}</li>' for x in t["shared"])}</ul></div>
      <div class="panel no reveal"><h3><i style="--c:var(--red)"></i>{e(t["never_h"])}</h3><ul>{''.join(f'<li>{e(x)}</li>' for x in t["never"])}</ul></div>
    </div>
    <ul class="bul when reveal">{''.join(f'<li><span><b>{e(a)}</b> {e(b)}</span></li>' if not b.startswith(',') else f'<li><span><b>{e(a)}</b>{e(b)}</span></li>' for a, b in t["when"])}</ul>
  </div>
</section>

<section class="light-sec" id="blocking">
  <div class="wrap">
    <div class="sh"><div class="eyebrow reveal">{e(t["s3_eye"])}</div><h2 class="big serif reveal">{e(t["s3_h"])}</h2></div>
    <ol class="steps4">{''.join(f'<li class="reveal"><h5>{e(a)}</h5><p>{e(b)}</p></li>' for a, b in t["steps"])}</ol>
  </div>
</section>

<section id="consent" class="grain" style="background:var(--night-2)">
  <div class="wrap">
    <div class="sh"><div class="eyebrow reveal">{e(t["s4_eye"])}</div><h2 class="big serif reveal">{e(t["s4_h"])}</h2></div>
    <ul class="bul reveal" style="max-width:820px;margin-top:40px">{''.join(f'<li><span><b>{e(a)}</b>{"" if b.startswith(",") else " "}{e(b)}</span></li>' for a, b in t["consent"])}</ul>
  </div>
</section>

<section class="light-sec" id="deletion">
  <div class="wrap">
    <div class="sh"><div class="eyebrow reveal">{e(t["s5_eye"])}</div><h2 class="big serif reveal">{e(t["s5_h"])}</h2></div>
    <div class="rows">{''.join(f'<div class="reveal"><h5>{e(a)}</h5><p>{e(b)}</p></div>' for a, b in t["rows"])}</div>
  </div>
</section>

<section id="where">
  <div class="wrap">
    <div class="sh"><div class="eyebrow reveal">{e(t["s6_eye"])}</div><h2 class="big serif reveal">{e(t["s6_h"])}</h2></div>
    <div class="cards3 where" style="margin-top:44px">{cards(t["cards6"])}</div>
  </div>
</section>

<section class="final grain" id="contact">
  <div class="wrap">
    <div class="mtl reveal" aria-hidden="true"><i style="--c:var(--red)"></i><i style="--c:var(--amber)"></i><i class="on" style="--c:var(--green)"></i></div>
    <h2 class="serif reveal">{e(t["s7_h"])}</h2>
    <p class="reveal">{e(t["s7_p"])}</p>
    <div class="cta reveal">
      <a class="btn btn-glow" href="mailto:{MAIL}">{MAIL}</a>
      <a class="btn btn-line" href="{PRIVACY}" target="_blank" rel="noopener">{e(t["s7_policy"])}</a>
    </div>
  </div>
</section>

<footer>
  <div class="wrap">
    <span>© 2026 Semafor by <a href="{home_path(code)}" data-home>Kastel Labs</a></span>
    <span class="links"><a href="mailto:{MAIL}">{MAIL}</a><a href="{sem_path(code)}">Semafor</a><a href="{data_path(code)}" aria-current="page">{e(t["foot_data"])}</a><a href="{PRIVACY}" target="_blank" rel="noopener">{e(t["nav_policy"])}</a><a href="{store}" target="_blank" rel="noopener">{e(t["foot_store"])}</a></span>
  </div>
</footer>

<script>
(function(){{
  {save_js}
  var nav=document.getElementById('nav');
  function onS(){{nav.classList.toggle('scrolled',scrollY>10)}} onS();
  addEventListener('scroll',onS,{{passive:true}});
  var io=new IntersectionObserver(function(es){{es.forEach(function(e){{if(e.isIntersecting){{e.target.classList.add('in');io.unobserve(e.target)}}}})}},{{threshold:.1}});
  document.querySelectorAll('.reveal').forEach(function(el){{io.observe(el)}});
}})();
</script>
</body>
</html>
'''
        h = inject(h, code)
        d = out + data_path(code).rstrip('/')
        os.makedirs(d, exist_ok=True)
        open(f'{d}/index.html', 'w').write(h)
    print('built data', [c for c, _, _ in langs])
