// Les écrans de l'app, repris de android/.../MainActivity.kt et ui/Screens.kt.

const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBAr2xlGR5KRsbQBSemxT8lFb1T-ZbfKVw',
  authDomain: 'une-parole-inspirante.firebaseapp.com',
  projectId: PROJECT_ID,
  storageBucket: 'une-parole-inspirante.firebasestorage.app',
  messagingSenderId: '94937305348',
  appId: '1:94937305348:web:3290413821f058f8718051',
};
const SUBSCRIBE_URL = `https://europe-west6-${PROJECT_ID}.cloudfunctions.net/subscribeWeb`;

const $ = (id) => document.getElementById(id);

// localStorage peut être indisponible (navigation privée) : l'app doit quand même s'afficher.
const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Rien à garder. */ }
  },
};

/** Pas d'abonnement sur le web : passé l'écran de bienvenue, on arrive directement sur la citation. */
let started = store.get('accueil') === 'vu';

function cachedCitation() {
  try { return JSON.parse(store.get('citation')); } catch { return null; }
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const canNotify = () => 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;

// --- Navigation -----------------------------------------------------------

const VIEWS = { welcome: 'view-welcome', citation: 'view-citation', about: 'view-about' };
const FITTED = { welcome: ['welcome-headline', 28], citation: ['citation-text', 24] };

let current = null;
let navigatedInApp = false;

function viewForLocation() {
  if (location.hash === '#a-propos') return 'about';
  return started ? 'citation' : 'welcome';
}

function render() {
  const next = viewForLocation();
  if (next === current) return;
  const first = current === null;
  current = next;
  for (const [name, id] of Object.entries(VIEWS)) $(id).hidden = name !== next;
  $('links').hidden = next === 'about';
  scrollTo(0, 0);
  if (next === 'welcome') prepareWelcome();
  if (next === 'citation') enterCitation();
  fit();
  if (!first) $(VIEWS[next]).focus({ preventScroll: true });
}

function goBack() {
  if (navigatedInApp) history.back();
  else {
    history.replaceState(null, '', location.pathname);
    render();
  }
}

/** Réduit le texte seulement s'il ferait dépasser l'écran, comme TextAutoSize sur Android. */
function fit() {
  const fitted = FITTED[current];
  if (!fitted) return;
  const [id, min] = fitted;
  const element = $(id);
  if (element.offsetParent === null) return;
  element.style.fontSize = '';
  const max = parseFloat(getComputedStyle(element).fontSize);
  const fits = (size) => {
    element.style.fontSize = `${size}px`;
    return document.documentElement.scrollHeight <= window.innerHeight;
  };
  if (fits(max)) return;
  let low = min;
  let high = max;
  while (high - low > 0.25) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  fits(low);
}

// --- Bienvenue ------------------------------------------------------------

function welcomeNote() {
  if (isIos() && !isInstalled()) return "Sur iPhone, ajoute ce site à l'écran d'accueil pour recevoir les notifications.";
  if (canNotify() && Notification.permission === 'default') return "Ton navigateur va te demander d'autoriser les notifications.";
  return '';
}

function prepareWelcome() {
  const note = welcomeNote();
  $('welcome-note').textContent = note;
  $('welcome-note').hidden = !note;
}

/** Une demande web n'est pas bloquante comme sur Android : si elle reste sans réponse, on ne doit pas rester coincé ici. */
function onContinue() {
  if (canNotify() && Notification.permission === 'default') {
    Notification.requestPermission().then(enablePush).catch(() => {});
  } else {
    enablePush();
  }
  started = true;
  store.set('accueil', 'vu');
  render();
}

// --- Notifications --------------------------------------------------------

/** Inscrit ce navigateur au même sujet de notifications que les téléphones Android. */
async function enablePush() {
  if (!canNotify() || Notification.permission !== 'granted') return;
  try {
    const [{ initializeApp }, { getMessaging, getToken }] = await Promise.all([
      import(`${FIREBASE_SDK}/firebase-app.js`),
      import(`${FIREBASE_SDK}/firebase-messaging.js`),
    ]);
    const serviceWorkerRegistration = await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(initializeApp(FIREBASE_CONFIG)), { serviceWorkerRegistration });
    if (token === store.get('jeton')) return;
    const response = await fetch(SUBSCRIBE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (response.ok) store.set('jeton', token);
  } catch (error) {
    console.warn('Notifications indisponibles :', error);
  }
}

// --- Citation -------------------------------------------------------------

function todayLong() {
  const label = new Intl.DateTimeFormat('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date()).replace(',', '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function showCitation(citation) {
  $('citation-empty').hidden = citation !== null;
  $('citation-body').hidden = citation === null;
  if (citation) {
    $('citation-text').textContent = citation.text;
    $('citation-reference').textContent = citation.reference;
  }
  fit();
}

/** Ce qui se voit à l'écran : une correction qui garde son heure de publication doit quand même s'afficher. */
const visibleContent = (citation) => (citation ? `${citation.text}\n${citation.reference}` : '');

function closeNotifications() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistration()
    .then((registration) => registration?.getNotifications())
    .then((notifications) => notifications?.forEach((notification) => notification.close()))
    .catch(() => {});
}

let refreshCount = 0;
let shown = null;

/** À chaque retour dans l'app, et toutes les minutes tant qu'elle reste ouverte : nouvelle citation éventuelle. */
async function refresh() {
  const count = ++refreshCount;
  $('citation-date').textContent = todayLong();
  let citation;
  try {
    citation = await currentCitation();
    store.set('citation', JSON.stringify(citation));
  } catch {
    citation = cachedCitation();
  }
  if (count !== refreshCount || current !== 'citation') return;
  // Ne pas réafficher ce qui est déjà à l'écran : pas de clignotement pendant la lecture.
  if (visibleContent(citation) !== shown) {
    shown = visibleContent(citation);
    showCitation(citation);
  }
  closeNotifications();
}

function enterCitation() {
  const cached = cachedCitation();
  if (cached) {
    shown = visibleContent(cached);
    showCitation(cached);
  }
  refresh();
}

// Un onglet peut rester ouvert des heures : on revérifie Firestore régulièrement, pas seulement au retour.
setInterval(() => {
  if (current === 'citation' && document.visibilityState === 'visible') refresh();
}, 60_000);

// --- Démarrage ------------------------------------------------------------

$('welcome-continue').addEventListener('click', onContinue);
document.querySelectorAll('[data-back]').forEach((button) => button.addEventListener('click', goBack));

window.addEventListener('hashchange', () => {
  navigatedInApp = true;
  render();
});
window.addEventListener('resize', fit);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && current === 'citation') refresh();
});
document.fonts?.ready.then(fit);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data === 'citation' && current === 'citation' && document.visibilityState === 'visible') refresh();
  });
}

render();
if (started) enablePush();
