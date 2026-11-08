// Quelle citation afficher : même logique que CitationRepository.kt et Versets.kt de l'app Android.
// Script classique, partagé entre la page et le service worker.

const PROJECT_ID = 'une-parole-inspirante';
const ZONE = 'Europe/Zurich';
const AUTO_HOUR = 10;
const AUTO = 'auto';
const LATEST_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;

const dayInZurich = (instant) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(instant);
const hourInZurich = (instant) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', hourCycle: 'h23' }).format(instant));

/** Nombre de jours depuis le 1er janvier 1970, comme LocalDate.toEpochDay() côté Android. */
const epochDay = (day) => Math.round(Date.UTC(...day.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0))) / 864e5);

function previousDay(day) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Identifie une publication, comme Citation.publicationId côté Android. */
const publicationId = (citation) => `${citation.day}@${citation.publishedAt}`;

let versets = null;

async function verseForDay(day) {
  if (!versets) {
    const response = await fetch('versets.json');
    if (!response.ok) throw new Error(`versets.json : ${response.status}`);
    versets = (await response.json()).versets;
  }
  // Multiplier par un nombre premier parcourt toute la liste avant de répéter un verset.
  const { text, reference } = versets[(epochDay(day) * 7919) % versets.length];
  return { day, text, reference, publishedAt: AUTO };
}

function latestQuery(until) {
  const publishAt = { fieldPath: 'publishAt' };
  return {
    structuredQuery: {
      from: [{ collectionId: 'citations' }],
      where: { fieldFilter: { field: publishAt, op: 'LESS_THAN_OR_EQUAL', value: { timestampValue: until.toISOString() } } },
      orderBy: [{ field: publishAt, direction: 'DESCENDING' }],
      limit: 1,
    },
  };
}

function parseLatest(results) {
  const document = results.find((result) => result.document)?.document;
  if (!document) return null;
  const { text, reference, publishAt } = document.fields;
  return {
    day: document.name.split('/').pop(),
    text: text.stringValue,
    reference: reference.stringValue,
    publishedAt: publishAt.timestampValue,
  };
}

/** Dernière citation publiée dans Firestore. Lève une exception si le réseau échoue. */
async function fetchLatest() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    // Marge de 2 minutes : un appareil dont l'horloge retarde doit quand même voir la citation qu'on vient de publier.
    const response = await fetch(LATEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(latestQuery(new Date(Date.now() + 120_000))),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Firestore a répondu ${response.status}`);
    return parseLatest(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

/** La citation à afficher maintenant. Avant 10 h, sans citation du jour, on reste sur la parole de la veille. */
async function currentCitation(now = new Date()) {
  const latest = await fetchLatest();
  const today = dayInZurich(now);
  if (latest?.day === today) return latest;
  const shownDay = hourInZurich(now) < AUTO_HOUR ? previousDay(today) : today;
  if (latest?.day === shownDay) return latest;
  return verseForDay(shownDay);
}
