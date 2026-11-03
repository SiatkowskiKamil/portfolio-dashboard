/* ===========================================================================
   i18n.js — Polish and English text for the whole report
   ---------------------------------------------------------------------------
   Every string the user can see lives here, in one dictionary per language.
   Nothing else in the application contains display text: render.js asks for
   a key, index.html marks static nodes with data-i18n, and app.js swaps the
   language and redraws.

   WHY SENTENCES ARE FUNCTIONS, NOT STRINGS WITH PLACEHOLDERS
   ----------------------------------------------------------
   The commentary blocks are generated sentences, and the two languages do not
   agree on how a number changes the words around it. Polish picks one of three
   forms ("1 projekt / 2 projekty / 5 projektów") and declines the surrounding
   verb with it; English needs only singular and plural but puts the words in a
   different order. A template like "{n} {noun} are running" cannot express
   both, so each language writes its own sentence in its own grammar and takes
   the raw numbers as arguments.

   The cost is that a new sentence has to be written twice. The benefit is that
   neither language reads like a translation, and a translator can work in this
   file alone without touching the report logic.

   ADDING A LANGUAGE
   -----------------
   Copy the `en` block, translate it, register it in LANGS below and add a
   button to the switch in index.html. Keys missing from a language fall back
   to Polish rather than showing a raw key, so a partial translation degrades
   gracefully instead of breaking the page.

   Load order: after config.js, before utils.js — utils.js reads the current
   language to format numbers and dates.
   =========================================================================== */

/* Languages offered by the switch, in the order they appear. */
const LANGS = [
  { code: 'pl', label: 'PL', locale: 'pl-PL', html: 'pl' },
  { code: 'en', label: 'EN', locale: 'en-GB', html: 'en' },
];

/* Current language. Read by utils.js for number and date formatting, and by
   t() below. Changed only through setLang() in app.js. */
let LANG = 'pl';

/** Locale tag for Intl / toLocaleString, derived from the current language. */
const LOCALE = () => (LANGS.find(l => l.code === LANG) || LANGS[0]).locale;

/* ---------------------------------------------------------------------------
   Grammar helpers used by the dictionaries below
   --------------------------------------------------------------------------- */

/* Polish uses pl() from utils.js: pl(n, one, few, many).
   English needs only two forms. */

/** English plural: one form for 1, another for everything else (including 0). */
const en1 = (n, one, many) => (n === 1 ? one : many);

/** "is"/"are" for an English count. */
const enIs = n => (n === 1 ? 'is' : 'are');

/** Joins a list in the language's own style: "a, b i c" / "a, b and c". */
const joinList = (arr, and) => arr.length < 2 ? (arr[0] || '')
  : arr.slice(0, -1).join(', ') + ' ' + and + ' ' + arr[arr.length - 1];

/* ===========================================================================
   DICTIONARIES
   ---------------------------------------------------------------------------
   Keys are grouped by where the text appears:
     ui.*     shared words, table headers, buttons
     gate.*   sign-in screen
     nav.*    left-hand navigation and page titles
     pods.*   Podsumowanie / Summary
     str.*    Struktura portfela / Portfolio structure
     war.*    Wartość biznesowa / Business value
     kon.*    Kondycja portfela / Portfolio health
     stg.*    Inicjatywy strategiczne / Strategic initiatives
     tf.*     column filters (tablefilter.js)
     msg.*    errors and status messages
   =========================================================================== */

const I18N = {};

/* ---------------------------------------------------------------------------
   POLISH
   --------------------------------------------------------------------------- */
I18N.pl = {

  /* ---- shared ---- */
  'ui.mln': 'mln',
  'ui.mlnPln': 'mln PLN',
  'ui.items': n => `${fmt(n)} poz.`,
  'ui.total': 'Razem',
  'ui.sum': 'Suma',
  'ui.noData': 'Brak danych.',
  'ui.share': 'Udział',
  'ui.projects': 'Projekty',
  'ui.initiatives': 'Inicjatywy',
  'ui.key': 'Nr PF',
  'ui.name': 'Nazwa',
  'ui.project': 'Projekt',
  'ui.owner': 'Właściciel',
  'ui.status': 'Status',
  'ui.rag': 'RAG',
  'ui.kind': 'Rodzaj',
  'ui.type': 'Typ',
  'ui.start': 'Start',
  'ui.end': 'Koniec',
  'ui.deadline': 'Termin',
  'ui.category': 'Kategoria',
  'ui.phase': 'Faza',
  'ui.ebitdaMln': 'EBITDA (mln)',
  'ui.capexMln': 'CAPEX (mln)',
  'ui.opexMln': 'OPEX (mln)',
  'ui.allUnits': 'Wszystkie jednostki',
  'ui.nUnits': n => `${n} jednostki`,
  'ui.selectAll': 'Zaznacz wszystko',
  'ui.noNumber': 'bez numeru',

  /* EBITDA horizon, declined. The number comes from the data source, so the
     label is built rather than written out. */
  'ui.ebHorizon': (n, form) => n + '-letni' + form,
  'ui.ebHorizonTable': n => `${n}-letnia EBITDA (mln)`,

  /* ---- sign-in ---- */
  'gate.title': 'Zaloguj się do Jiry',
  'gate.sub': 'Dashboard pobiera dane bezpośrednio z Jira Cloud. Token zostaje w pamięci przeglądarki na czas sesji i nie jest nigdzie zapisywany.',
  'gate.url': 'Adres Jiry',
  'gate.email': 'E-mail służbowy',
  'gate.token': 'Token API',
  'gate.tokenPlaceholder': 'Wklej token z konta Atlassian',
  'gate.tokenHint': 'Token wygenerujesz na koncie Atlassian, w sekcji Security / API tokens.',
  'gate.submit': 'Połącz z Jirą',
  'gate.submitServer': 'Wczytaj dane z Jiry',
  'gate.connecting': 'Łączę z Jirą…',
  'gate.demo': 'Dane demonstracyjne',
  'gate.paste': 'Wklej eksport JSON',

  /* ---- chrome ---- */
  'app.brand': 'Portfel projektów',
  'app.asOf': 'Stan na',
  'app.themeLight': 'Jasny',
  'app.themeDark': 'Ciemny',
  'app.srcDemo': 'dane demonstracyjne',
  'app.srcJira': n => `Jira · ${fmt(n)} zgł.`,
  'app.srcImport': (n, more) => `import · ${fmt(n)} zgł.${more ? ' · niepełne' : ''}`,

  /* ---- navigation and page titles ---- */
  'nav.summary': 'Podsumowanie',
  'nav.structure': 'Struktura portfela',
  'nav.value': 'Wartość biznesowa',
  'nav.health': 'Kondycja portfela',
  'nav.strategy': 'Inicjatywy strategiczne',
  'title.summary': 'Ocena kondycji portfela',
  'title.structure': 'Struktura i skala portfela',
  'title.value': 'Wartość biznesowa aktywnego portfela',
  'title.health': 'Kondycja aktywnego portfela',
  'title.strategy': 'Kontrybucja w realizacji inicjatyw strategicznych',
  'block.comment': 'Komentarz',

  /* ---- summary page ---- */
  'pods.lede': units => units.length
    ? `Przegląd jednostek: ${units.join(', ')}.`
    : 'Przegląd całego portfela.',
  'pods.cardPortfolio': 'Przedsięwzięcia w portfelu',
  'pods.cardRunning': 'W realizacji',
  'pods.cardEbitda': 'EBITDA realizowanych przedsięwzięć',
  'pods.cardEnding': y => `Zakończenia projektów w ${y}`,
  'pods.tableHead': 'Realizowane przedsięwzięcia',

  'pods.c1': (all, proj, init) =>
    `Portfel obejmuje <b>${fmt(all)}</b> ${pl(all, 'przedsięwzięcie', 'przedsięwzięcia', 'przedsięwzięć')}, w tym <b>${fmt(proj)}</b> ${pl(proj, 'projekt', 'projekty', 'projektów')} i <b>${fmt(init)}</b> ${pl(init, 'inicjatywę', 'inicjatywy', 'inicjatyw')}.`,

  'pods.c2': (proj, init, planned) =>
    `Obecnie ${pl(proj, 'realizowany jest', 'realizowane są', 'realizowanych jest')} <b>${fmt(proj)}</b> ${pl(proj, 'projekt', 'projekty', 'projektów')} i <b>${fmt(init)}</b> ${pl(init, 'inicjatywa', 'inicjatywy', 'inicjatyw')}; <b>${fmt(planned)}</b> ${pl(planned, 'przedsięwzięcie pozostaje', 'przedsięwzięcia pozostają', 'przedsięwzięć pozostaje')} w planowaniu.`,

  'pods.c3': (year, ending, startP, startI) =>
    `W roku ${year} planowane jest zakończenie <b>${fmt(ending)}</b> ${pl(ending, 'projektu', 'projektów', 'projektów')} oraz uruchomienie ${startP === 1 ? '<b>1</b> kolejnego projektu' : `kolejnych <b>${fmt(startP)}</b> projektów`}${startI ? ` i <b>${fmt(startI)}</b> ${pl(startI, 'inicjatywy', 'inicjatyw', 'inicjatyw')}` : ''}.`,

  'pods.c4': (withEb, all, horizon, total, span, ebP, nP, ebI, nI) => {
    const part = (v, n, what) => n ? `<b>${fmt1(v)} mln</b> dla ${what}` : `brak danych dla ${what}`;
    return `Dla <b>${fmt(withEb)}</b> z <b>${fmt(all)}</b> ${pl(all, 'realizowanego przedsięwzięcia', 'realizowanych przedsięwzięć', 'realizowanych przedsięwzięć')} prognozowana ${horizon} EBITDA wynosi <b>${fmt1(total)} mln PLN</b> (perspektywa ${span}): ${part(ebP, nP, 'projektów')} i ${part(ebI, nI, 'inicjatyw')}.`;
  },
  'pods.c4missing': (n, fromFile) =>
    ` Dla <b>${fmt(n)}</b> ${pl(n, 'przedsięwzięcia', 'przedsięwzięć', 'przedsięwzięć')} EBITDA ${fromFile ? 'nie występuje w pliku wartości biznesowej' : 'nie jest uzupełniona w Jirze'}, więc ${pl(n, 'nie wchodzi', 'nie wchodzą', 'nie wchodzi')} do tej sumy.`,

  'pods.scopeNote': (proj, init) =>
    `${fmt(proj)} ${pl(proj, 'projekt', 'projekty', 'projektów')} · ${fmt(init)} ${pl(init, 'inicjatywa', 'inicjatywy', 'inicjatyw')}`,
  'pods.emptyProj': 'Brak realizowanych projektów w wybranym zakresie.',
  'pods.emptyInit': 'Brak realizowanych inicjatyw w wybranym zakresie.',
  'pods.emptyBoth': 'Brak realizowanych przedsięwzięć w wybranym zakresie.',

  /* ---- unit-membership control line ---- */
  'diag.units': 'Jednostki raportowe: ',
  'diag.unit': (name, field, values, n) =>
    `<b>${name}</b> — pole ${field} zawiera ${values.map(v => `„${v}”`).join(' lub ')} (${n ? `${fmt(n)} ${pl(n, 'zgłoszenie', 'zgłoszenia', 'zgłoszeń')}` : '<b>0 zgłoszeń</b>'})`,
  'diag.overlap': n =>
    ` <b>${fmt(n)}</b> ${pl(n, 'zgłoszenie należy', 'zgłoszenia należą', 'zgłoszeń należy')} do więcej niż jednej jednostki — w całym portfelu ${pl(n, 'liczy się', 'liczą się', 'liczy się')} raz, ale przy liczeniu jednostek osobno ${pl(n, 'wchodzi', 'wchodzą', 'wchodzi')} do obu.`,
  'diag.dropped': n =>
    ` ${fmt(n)} ${pl(n, 'zgłoszenie z Jiry nie pasuje', 'zgłoszenia z Jiry nie pasują', 'zgłoszeń z Jiry nie pasuje')} do żadnej reguły i nie ${pl(n, 'wchodzi', 'wchodzą', 'wchodzi')} do raportu.`,
  'diag.roadmapFrom': list =>
    ` Wartości pola Roadmap przyszły z: ${list} — zostaw w CFG.fields.roadmap samo to ID.`,
  'diag.roadmapNone':
    ' <b>Żadne ze skonfigurowanych pól Roadmap nie zwróciło wartości</b> — sprawdź CFG.fields.roadmap w js/config.js.',

  /* ---- RAG sentence, shared by Summary and Health ---- */
  'rag.noneProj': 'Brak realizowanych projektów.',
  'rag.noneInit': 'Brak realizowanych inicjatyw.',
  'rag.sentence': (kind, n, green, amber, red, noRag) => {
    const noun = kind === 'proj'
      ? pl(n, 'realizowanego projektu', 'realizowanych projektów', 'realizowanych projektów')
      : pl(n, 'realizowanej inicjatywy', 'realizowanych inicjatyw', 'realizowanych inicjatyw');
    let s = `${kind === 'proj' ? 'Spośród' : 'Wśród'} <b>${fmt(n)}</b> ${noun} <b>${fmt(green)}</b> ${pl(green, 'posiada', 'posiadają', 'posiada')} status Green`;
    s += red ? `, <b>${fmt(amber)}</b> status Amber, a <b>${fmt(red)}</b> status Red.`
             : `, a <b>${fmt(amber)}</b> status Amber.`;
    if (noRag) s += ` ${fmt(noRag)} ${pl(noRag, 'nie ma', 'nie mają', 'nie ma')} ustawionego statusu RAG.`;
    return s;
  },
  'rag.ebitdaParts': parts => ` Prognozowana EBITDA: ${parts.join(', ')}.`,
  'rag.ebitdaPart': (name, v, share) => `${name} ${fmt(Math.round(v))} mln PLN (${share})`,

  /* ---- structure page ---- */
  'str.lede': 'Portfel obejmuje przedsięwzięcia w statusach Delivery, Analysis i Preparation. Realizowane to Delivery i Analysis łącznie.',
  'str.matrixHead': 'Struktura portfela',
  'str.matrixHint': 'Kliknij wiersz, aby zawęzić listę szczegółów obok.',
  'str.detailHead': 'Szczegóły',
  'str.running': 'Realizowane',
  'str.planned': 'Planowane',
  'str.startBy': y => `Start do końca ${y}`,
  'str.startFrom': y => `Start ${y}`,
  'str.noStart': 'Brak daty startu',
  'str.emptyDetail': 'Brak pozycji.',
  'str.soonHead': 'Planowane uruchomienia',
  'str.soonNote': (from, to, n) => `${from} – ${to} · ${fmt(n)} poz.`,
  'str.soonEmptyProj': 'Brak uruchomień projektów w tym okresie.',
  'str.soonEmptyInit': 'Brak uruchomień inicjatyw w tym okresie.',
  'str.soonEmptyBoth': 'Brak uruchomień w tym okresie.',
  'str.c1': (all, proj, init) =>
    `Portfel obejmuje <b>${fmt(all)}</b> ${pl(all, 'przedsięwzięcie', 'przedsięwzięcia', 'przedsięwzięć')}, w tym <b>${fmt(proj)}</b> ${pl(proj, 'projekt', 'projekty', 'projektów')} i <b>${fmt(init)}</b> ${pl(init, 'inicjatywę', 'inicjatywy', 'inicjatyw')}.`,
  'str.c2': (running, planned) =>
    `Obecnie ${pl(running, 'realizowane jest', 'realizowane są', 'realizowanych jest')} <b>${fmt(running)}</b> ${pl(running, 'przedsięwzięcie', 'przedsięwzięcia', 'przedsięwzięć')}, natomiast <b>${fmt(planned)}</b> ${pl(planned, 'pozostaje', 'pozostają', 'pozostaje')} w planowaniu.`,
  'str.c3': (total, proj, init, year) =>
    `Spośród przedsięwzięć planowanych <b>${fmt(total)}</b> ${pl(total, 'jest przewidziane', 'są przewidziane', 'jest przewidzianych')} do uruchomienia jeszcze w ${year} roku: <b>${fmt(proj)}</b> ${pl(proj, 'projekt', 'projekty', 'projektów')} i <b>${fmt(init)}</b> ${pl(init, 'inicjatywa', 'inicjatywy', 'inicjatyw')}.`,
  'str.c3none': year => `Żadne z planowanych przedsięwzięć nie ma startu przewidzianego do końca ${year} roku.`,

  /* ---- business value page ---- */
  'war.lede': (horizon, span) =>
    `Prognozowana ${horizon} EBITDA realizowanych projektów (perspektywa ${span}) w podziale na kategorię biznesową i planowany rok zakończenia, zestawiona z budżetem CAPEX i OPEX oraz z wartością już dostarczoną.`,
  'war.catHead': 'Projekty realizowane wg kategorii',
  'war.catShares': 'udziały',
  'war.catValues': 'wartości',
  'war.catWaiting': 'oczekuje na dane z Jiry',
  'war.yearHead': 'Projekty realizowane wg planowanego roku zakończenia',
  'war.yearCol': 'Rok zakończenia',
  'war.noEndDate': 'Brak daty',
  'war.doneHead': 'Projekty realizowane i zakończone',
  'war.group': 'Grupa',
  'war.groupRunning': 'Realizowane',
  'war.groupDoneYear': y => `Zakończone w ${y}`,
  'war.groupDoneRange': (a, b) => `Zakończone ${a}–${b}`,
  'war.groupDoneOlder': 'Zakończone wcześniej',
  'war.doneSrc': 'Zakończone projekty przypisano do roku na podstawie planowanego terminu zakończenia — Jira nie zapisuje daty faktycznego zamknięcia. W oryginalnym raporcie wiersz Razem tej tabeli sumuje EBITDA wszystkich grup, ale liczbę projektów tylko dwóch pierwszych; tutaj sumowane są wszystkie.',
  'war.compHead': 'Projekty Compliance generujące dodatnią EBITDA',
  'war.compWaiting': 'oczekuje na mapowanie',
  'war.compEmpty': 'Brak takich projektów w wybranym zakresie.',
  'war.compNoCat': 'Tabela wymaga kategorii z pliku wartości biznesowej.',
  'war.konceHead': y => `Projekty z planowanym zakończeniem w ${y}`,
  'war.konceEmpty': 'Brak projektów kończących się w tym roku.',
  'war.listHead': 'Realizowane projekty wg wartości',
  'war.listNote': (n, total, missing) =>
    `${fmt(n)} poz. · razem ${fmt1(total)} mln` + (missing ? ` · ${fmt(missing)} bez wartości` : ''),
  'war.listEmpty': 'Brak projektów.',
  'war.ebitdaYear': y => `EBITDA ${y}`,

  'war.c1': (n, horizon, total, span) =>
    `<b>${fmt(n)}</b> ${pl(n, 'realizowany projekt generuje', 'realizowane projekty generują', 'realizowanych projektów generuje')} prognozowaną ${horizon} EBITDA na poziomie <b>${fmt(Math.round(total))} mln PLN</b> (perspektywa ${span})`,
  'war.c1missing': (missing, all) =>
    `; dla pozostałych <b>${fmt(missing)}</b> z <b>${fmt(all)}</b> realizowanych projektów wartości nie ma w źródle.`,
  'war.c1years': parts => `W rozbiciu na lata: ${parts.join(', ')}.`,
  'war.c1year': (y, v) => `<b>${y}</b> ${fmt1(v)} mln`,
  'war.cGrowthShare': (share, n, all) =>
    `Projekty Growth stanowią <b>${share}</b> realizowanych projektów (${fmt(n)} z ${fmt(all)}).`,
  'war.cGrowthEbitda': (share, horizon, v) =>
    `Projekty Growth generują <b>${share}</b> prognozowanej ${horizon} EBITDA aktywnego portfela (${fmt(Math.round(v))} mln PLN).`,
  'war.cGrowthCapex': share =>
    `<b>${share}</b> budżetu CAPEX realizowanych projektów kierowane jest do projektów typu Growth.`,
  'war.cNoCat': 'Podział na kategorie Growth / Compliance / Maintenance czeka na plik wartości biznesowej albo na pole z klasyfikacją w Jirze — do tego czasu udziały kategorii nie są liczone.',
  'war.cBudget': (capex, opex) =>
    `Budżet realizowanych projektów: CAPEX <b>${fmt1(capex)} mln PLN</b>, OPEX <b>${fmt1(opex)} mln PLN</b>.`,
  'war.cBudgetMissing': n =>
    ` Dla ${fmt(n)} ${pl(n, 'projektu', 'projektów', 'projektów')} CAPEX nie jest uzupełniony w Jirze.`,
  'war.cEbMissing': (n, fromFile) =>
    `Dla <b>${fmt(n)}</b> ${pl(n, 'projektu', 'projektów', 'projektów')} nie ma EBITDA ${fromFile ? 'w arkuszu wartości biznesowej' : 'w Jirze'}, więc ${pl(n, 'nie wchodzi', 'nie wchodzą', 'nie wchodzi')} do powyższych sum.`,

  'war.srcFile': (file, years, horizon) =>
    `EBITDA pochodzi z pliku ${file}: kolumny z latami ${years.join(', ')} i kolumna „${horizon} EBITDA”. Suma jest czytana z własnej kolumny, a nie dodawana z lat — arkusz zaokrągla każdy rok, więc części nie zawsze sumują się do liczby, którą podaje. CAPEX i OPEX nadal pochodzą z Jiry (pola CAPEX [K] i OPEX [K], w tysiącach PLN). EBITDA z pliku obowiązuje w całym raporcie — tam, gdzie zgłoszenia w pliku nie ma, raport pokazuje kreskę zamiast wartości z Jiry, żeby nie mieszać dwóch horyzontów w jednej sumie. Rozwiązanie tymczasowe: po wystawieniu tabeli przez dział danych zmieni się samo źródło, definicje zostaną te same.`,
  'war.srcJira': years =>
    `Pola EBITDA [K], CAPEX [K] i OPEX [K] w Jirze są podane w tysiącach PLN. EBITDA to prognoza łączna na ${years} lat — czysty odczyt z pola EBITDA [K], bez żadnego przeliczania. Rozbicia na lata w Jirze nie ma; daje je plik wartości biznesowej, którego teraz nie wczytano.`,

  'war.catSrcFile': (file, note, years, horizon, covered, all, missing, zero) =>
    `Liczby na tej stronie pochodzą z pliku <b>${file}</b> (${note}): EBITDA w rozbiciu na lata ${years.join(', ')} wraz z sumą ${horizon}, oraz kategoria z kolumny Project Type. Arkusz podaje tysiące PLN, mimo że nagłówki mówią „(PLN)”. Pokrycie: <b>${fmt(covered)}</b> z <b>${fmt(all)}</b> realizowanych ${pl(all, 'projektu', 'projektów', 'projektów')} w arkuszu` +
    (zero
      ? `. <b>Żaden numer PF z arkusza nie pasuje do wczytanych danych</b> — tak wygląda arkusz z prawdziwymi numerami zestawiony z danymi demonstracyjnymi, które mają własne. Na danych z Jiry pokrycie będzie realne.`
      : missing > 0
        ? `; pozostałe <b>${fmt(missing)}</b> ${pl(missing, 'nie ma', 'nie mają', 'nie ma')} tu EBITDA i ${pl(missing, 'nie wchodzi', 'nie wchodzą', 'nie wchodzi')} do sum — w tabeli widać przy nich kreskę.`
        : '.') +
    ` Ten sam plik jest źródłem EBITDA na pozostałych stronach raportu, więc wszystkie sumy w raporcie mają ten sam horyzont.`,
  'war.catSrcNoFile': (reason, years, hasCat) =>
    `<b>Nie wczytano pliku wartości biznesowej.</b> ${reason} Dopóki pliku nie ma: EBITDA pochodzi z pola EBITDA [K] w Jirze i jest prognozą na ${years} lat, bez rozbicia na lata, a kategorie ` +
    (hasCat
      ? 'liczone są z pola Project classification w Jirze (CFG.categoryMap w js/config.js) — jeśli tabela wyżej pokazuje same zera, to znaczy, że tego pola nie ma na ekranie projektu PF.'
      : 'są wyłączone (fields.category = null w js/config.js), więc podziału nie da się policzyć.') +
    ' Sprawdź konsolę serwera: po odświeżeniu strony powinna wypisać linijkę <code>/api/valuation -&gt; …</code>.',

  /* ---- health page ---- */
  'kon.lede': 'Zgodność z pierwotnym harmonogramem liczona jako różnica między aktualnym a pierwotnym terminem zakończenia. Tolerancja ±30 dni.',
  'kon.ragHead': 'Realizowane projekty wg statusu RAG',
  'kon.onTime': (share, n, all) =>
    `<b>${share}</b> analizowanych projektów ${pl(n, 'realizowany jest', 'realizowane są', 'realizowanych jest')} zgodnie z harmonogramem (${fmt(n)} z ${fmt(all)}).`,
  'kon.noBaseline': n =>
    ` Dla ${fmt(n)} ${pl(n, 'projektu', 'projektów', 'projektów')} brak pierwotnego planu w Jirze, więc ${pl(n, 'nie jest analizowany', 'nie są analizowane', 'nie są analizowane')}.`,
  'kon.noAnalysed': 'Brak projektów z pierwotnym harmonogramem do analizy.',
  'kon.delayed': (share, n, months) =>
    `<b>${share}</b> analizowanych projektów wykazuje opóźnienia względem pierwotnego harmonogramu (${fmt(n)} ${pl(n, 'projekt', 'projekty', 'projektów')}, średnio ${fmt(months)} ${pl(months, 'miesiąc', 'miesiące', 'miesięcy')}).`,
  'kon.delayedThisYear': (n, year) =>
    ` W tym ${fmt(n)} ${pl(n, 'rozpoczęty', 'rozpoczęte', 'rozpoczętych')} w ${year} roku.`,
  'kon.delayedNoneThisYear': year => ` Wszystkie rozpoczęły się przed ${year} rokiem.`,
  'kon.ahead': n =>
    ` ${fmt(n)} ${pl(n, 'projekt kończy się', 'projekty kończą się', 'projektów kończy się')} wcześniej, niż zakładano.`,
  'kon.noDelays': 'Żaden z analizowanych projektów nie wykazuje opóźnień względem pierwotnego harmonogramu.',
  'kon.avgDuration': (year, months, bench, benchLabel, diffText, basedOn) =>
    `Średni planowany czas realizacji projektów rozpoczętych w ${year} roku wynosi <b>${months}</b> ${pl(months, 'miesiąc', 'miesiące', 'miesięcy')}` +
    (bench !== null ? ` wobec <b>${bench}</b> ${pl(bench, 'miesiąca', 'miesięcy', 'miesięcy')} w analizie z ${benchLabel} (${diffText})` : '') +
    (basedOn !== null ? ` – na podstawie ${fmt(basedOn)} ${pl(basedOn, 'projektu', 'projektów', 'projektów')}.` : '.'),
  'kon.diffShorter': n => `o ${n} ${pl(n, 'miesiąc', 'miesiące', 'miesięcy')} krócej`,
  'kon.diffLonger': n => `o ${n} ${pl(n, 'miesiąc', 'miesiące', 'miesięcy')} dłużej`,
  'kon.diffSame': 'bez zmian',
  'kon.benchFallback': 'grudnia 2025 roku',

  /* ---- strategy page ---- */
  'stg.lede': 'Powiązania przedsięwzięć z inicjatywami strategicznymi wskazuje zespół ds. strategii. Status i RAG pochodzą z Jiry.',
  'stg.barsHead': 'Liczba powiązanych przedsięwzięć',
  'stg.matrixHead': 'Macierz powiązań',
  'stg.totalRow': 'Liczba powiązanych projektów i inicjatyw',
  'stg.empty': 'Brak powiązań w wybranym zakresie.',
  'stg.c1': (proj, init) =>
    `<b>${fmt(proj)}</b> ${pl(proj, 'projekt', 'projekty', 'projektów')} oraz <b>${fmt(init)}</b> ${pl(init, 'inicjatywa', 'inicjatywy', 'inicjatyw')} ${pl(proj + init, 'wspiera', 'wspierają', 'wspiera')} realizację inicjatyw strategicznych.`,
  'stg.c2': (running, prep, done) =>
    `<b>${fmt(running)}</b> ${pl(running, 'przedsięwzięcie znajduje się', 'przedsięwzięcia znajdują się', 'przedsięwzięć znajduje się')} obecnie w realizacji, <b>${fmt(prep)}</b> ${pl(prep, 'pozostaje', 'pozostają', 'pozostaje')} w przygotowaniu` +
    (done ? `, a <b>${fmt(done)}</b> ${pl(done, 'zostało zakończone', 'zostały zakończone', 'zostało zakończonych')}` : '') + '.',
  'stg.c3': parts => `Najsilniejsze wsparcie dotyczy inicjatyw: ${parts.join(', ')}.`,
  'stg.c4': (n, names) =>
    `Dla <b>${fmt(n)}</b> ${pl(n, 'inicjatywy', 'inicjatyw', 'inicjatyw')} nie zidentyfikowano powiązanych przedsięwzięć: ${names.join(', ')}.`,
  'stg.c4none': 'Każda inicjatywa strategiczna ma co najmniej jedno powiązane przedsięwzięcie.',
  'stg.c5': n =>
    `<b>${fmt(n)}</b> ${pl(n, 'pozycja w arkuszu nie ma', 'pozycje w arkuszu nie mają', 'pozycji w arkuszu nie ma')} jeszcze numeru PF, więc ${pl(n, 'figuruje', 'figurują', 'figuruje')} w macierzy bez statusu i RAG — ${pl(n, 'nie jest liczona', 'nie są liczone', 'nie są liczone')} w podziale na projekty i inicjatywy powyżej.`,

  'stg.upload': 'Wgraj nową wersję',
  'stg.uploading': 'Wczytuję…',
  'stg.uploadedAt': (date, who) =>
    ` · wgrano ${date}` + (who ? ` przez ${who}` : ''),
  'stg.uploadStale': days =>
    ` · <b>macierz sprzed ${fmt(days)} ${pl(days, 'dnia', 'dni', 'dni')}</b> — sprawdź, czy zespół ds. strategii nie ma nowszej wersji`,
  'stg.uploadOk': (rows, links) =>
    `Wczytano macierz: ${fmt(rows)} ${pl(rows, 'pozycja', 'pozycje', 'pozycji')}, ${fmt(links)} ${pl(links, 'powiązanie', 'powiązania', 'powiązań')}.`,
  'stg.uploadFailed': err => `Nie wczytano: ${err}`,
  'stg.uploadNoServer': 'Wgrywanie wymaga serwera — uruchom aplikację przez serve.ps1.',

  /* ---- column filters ---- */
  'tf.search': 'Szukaj wartości…',
  'tf.searchAria': col => `Szukaj w kolumnie ${col}`,
  'tf.selectAll': 'Zaznacz wszystko',
  'tf.clearColumn': 'Wyczyść filtr kolumny',
  'tf.noMatches': 'Brak wartości pasujących do wyszukiwania.',
  'tf.empty': '(puste)',
  'tf.allHidden': 'Filtry kolumn ukryły wszystkie wiersze.',
  'tf.hidden': (hidden, total) => ` · ukryto ${fmt(hidden)} z ${fmt(total)} `,
  'tf.clearAll': n => `wyczyść filtry (${n})`,
  'tf.filterCol': col => `Filtruj kolumnę ${col}`,
  'tf.filterTitle': 'Filtruj kolumnę',
  'tf.sortCol': col => `Sortuj wg kolumny ${col}`,

  /* ---- messages ---- */
  'msg.noIssues': 'Jira nie zwróciła żadnych zgłoszeń dla tego zapytania.',
  'msg.needCreds': 'Podaj adres e-mail i token API.',
  'msg.authFailed': 'Jira odrzuciła logowanie (sprawdź adres e-mail i token).',
  'msg.httpError': code => `Jira zwróciła błąd ${code}.`,
  'msg.cors': `<b>Przeglądarka zablokowała połączenie z Jirą.</b> Atlassian nie zezwala na zapytania
     do API bezpośrednio ze strony — to zabezpieczenie CORS, niezależne od poprawności tokena
     i od sieci, w której pracujesz. Połączenie ruszy, gdy aplikacja zostanie uruchomiona na
     serwerze firmowym pośredniczącym w zapytaniach. Na teraz skorzystaj z przycisku
     <b>Dane demonstracyjne</b> albo <b>Wklej eksport JSON</b>.`,
  'msg.insecure': `<b>Połączenie nie jest szyfrowane.</b> Ta strona działa po HTTP, więc token
      API zostanie wysłany jawnym tekstem i może go odczytać każdy, kto widzi ruch w sieci.
      Token Atlassiana daje pełny dostęp do konta, nie tylko do odczytu projektu PF.
      Wygeneruj token wyłącznie na potrzeby tego dashboardu i unieważnij go, gdy przestanie
      być potrzebny. Docelowo serwer musi mieć certyfikat HTTPS.`,
  'msg.pasteIntro': `<b>Import eksportu z Jiry.</b> Wklej zawartość odpowiedzi z /rest/api/3/search/jql.
    Jeśli portfel nie zmieścił się na jednej stronie, wklej kolejne porcje jedna pod drugą —
    zostaną połączone, a duplikaty pominięte.`,
  'msg.pasteGo': 'Wczytaj',
  'msg.pasteFailed': err => `Nie udało się odczytać danych: ${err}`,
  'msg.refFailed': err => `<b>Nie udało się wczytać danych referencyjnych.</b> ${err}<br><br>
      Jeśli otworzyłeś plik dwuklikiem, uruchom aplikację przez serwer:
      <code>powershell -ExecutionPolicy Bypass -File tools\\serve.ps1</code>, a potem wejdź na
      <code>http://localhost:8000</code>. Szczegóły w pliku README.md.`,
  'msg.apiOld': 'Plik js/api.js jest ze starszej wersji (brak Api.loadValuation). Nadpisz go.',
  'msg.valNoteFull': i => i.kind === 'ok'
    ? `Excel · ${fmt(i.count)} ${pl(i.count, 'projekt', 'projekty', 'projektów')}` +
      (i.sheets.length ? ` · ${i.sheets.join(' + ')}` : '') +
      (i.dups ? ` · ${fmt(i.dups)} ${pl(i.dups, 'duplikat', 'duplikaty', 'duplikatów')} pominięto` : '')
    : i.kind === 'noserver' ? 'Plik wartości biznesowej wymaga serwera (serve.ps1).'
    : `Nie udało się odczytać pliku wartości biznesowej: ${i.err}`,
  'msg.refNoteFull': i => i.kind === 'ok'
    ? `Excel · ${fmt(i.rows)} ${pl(i.rows, 'pozycja', 'pozycje', 'pozycji')}` +
      (i.sheet ? ` · arkusz „${i.sheet}”` : '') +
      (i.extras ? ` · ${fmt(i.extras)} bez numeru PF` : '')
    : `Nie udało się odczytać pliku Excel — dane z kopii zapasowej. ${i.err}`,
  'msg.loadFailed': (path, code) => `Nie udało się wczytać ${path} (HTTP ${code}).`,
  'msg.pasteEmpty': 'Pole jest puste.',
  'msg.pasteNoIssues': 'Nie znaleziono zgłoszeń (pole "issues").',
};

/* ---------------------------------------------------------------------------
   ENGLISH
   --------------------------------------------------------------------------- */
I18N.en = {

  /* ---- shared ---- */
  'ui.mln': 'm',
  'ui.mlnPln': 'm PLN',
  'ui.items': n => `${fmt(n)} ${en1(n, 'item', 'items')}`,
  'ui.total': 'Total',
  'ui.sum': 'Total',
  'ui.noData': 'No data.',
  'ui.share': 'Share',
  'ui.projects': 'Projects',
  'ui.initiatives': 'Initiatives',
  'ui.key': 'Issue',
  'ui.name': 'Name',
  'ui.project': 'Project',
  'ui.owner': 'Owner',
  'ui.status': 'Status',
  'ui.rag': 'RAG',
  'ui.kind': 'Type',
  'ui.type': 'Type',
  'ui.start': 'Start',
  'ui.end': 'End',
  'ui.deadline': 'Due',
  'ui.category': 'Category',
  'ui.phase': 'Phase',
  'ui.ebitdaMln': 'EBITDA (m)',
  'ui.capexMln': 'CAPEX (m)',
  'ui.opexMln': 'OPEX (m)',
  'ui.allUnits': 'All units',
  'ui.nUnits': n => `${n} units`,
  'ui.selectAll': 'Select all',
  'ui.noNumber': 'no issue number',

  /* English needs no case endings, so the second argument is ignored. */
  'ui.ebHorizon': n => `${n}-year`,
  'ui.ebHorizonTable': n => `${n}-year EBITDA (m)`,

  /* ---- sign-in ---- */
  'gate.title': 'Sign in to Jira',
  'gate.sub': 'The dashboard reads data straight from Jira Cloud. Your token stays in the browser for this session only and is never stored.',
  'gate.url': 'Jira URL',
  'gate.email': 'Work e-mail',
  'gate.token': 'API token',
  'gate.tokenPlaceholder': 'Paste the token from your Atlassian account',
  'gate.tokenHint': 'Create a token in your Atlassian account under Security / API tokens.',
  'gate.submit': 'Connect to Jira',
  'gate.submitServer': 'Load data from Jira',
  'gate.connecting': 'Connecting to Jira…',
  'gate.demo': 'Demo data',
  'gate.paste': 'Paste JSON export',

  /* ---- chrome ---- */
  'app.brand': 'Project portfolio',
  'app.asOf': 'As of',
  'app.themeLight': 'Light',
  'app.themeDark': 'Dark',
  'app.srcDemo': 'demo data',
  'app.srcJira': n => `Jira · ${fmt(n)} issues`,
  'app.srcImport': (n, more) => `import · ${fmt(n)} issues${more ? ' · incomplete' : ''}`,

  /* ---- navigation and page titles ---- */
  'nav.summary': 'Summary',
  'nav.structure': 'Portfolio structure',
  'nav.value': 'Business value',
  'nav.health': 'Portfolio health',
  'nav.strategy': 'Strategic initiatives',
  'title.summary': 'Portfolio health assessment',
  'title.structure': 'Portfolio structure and scale',
  'title.value': 'Business value of the active portfolio',
  'title.health': 'Health of the active portfolio',
  'title.strategy': 'Contribution to strategic initiatives',
  'block.comment': 'Commentary',

  /* ---- summary page ---- */
  'pods.lede': units => units.length
    ? `Overview of ${units.join(', ')}.`
    : 'Overview of the whole portfolio.',
  'pods.cardPortfolio': 'Items in the portfolio',
  'pods.cardRunning': 'In progress',
  'pods.cardEbitda': 'EBITDA of items in progress',
  'pods.cardEnding': y => `Projects completing in ${y}`,
  'pods.tableHead': 'Items in progress',

  'pods.c1': (all, proj, init) =>
    `The portfolio holds <b>${fmt(all)}</b> ${en1(all, 'item', 'items')}: <b>${fmt(proj)}</b> ${en1(proj, 'project', 'projects')} and <b>${fmt(init)}</b> ${en1(init, 'initiative', 'initiatives')}.`,

  'pods.c2': (proj, init, planned) =>
    `<b>${fmt(proj)}</b> ${en1(proj, 'project', 'projects')} and <b>${fmt(init)}</b> ${en1(init, 'initiative', 'initiatives')} ${enIs(proj + init)} currently in progress; <b>${fmt(planned)}</b> ${enIs(planned)} still in planning.`,

  'pods.c3': (year, ending, startP, startI) =>
    `In ${year}, <b>${fmt(ending)}</b> ${en1(ending, 'project is', 'projects are')} due to complete and <b>${fmt(startP)}</b> further ${en1(startP, 'project is', 'projects are')} due to start${startI ? `, along with <b>${fmt(startI)}</b> ${en1(startI, 'initiative', 'initiatives')}` : ''}.`,

  'pods.c4': (withEb, all, horizon, total, span, ebP, nP, ebI, nI) => {
    const part = (v, n, what) => n ? `<b>${fmt1(v)} m</b> from ${what}` : `no data for ${what}`;
    return `For <b>${fmt(withEb)}</b> of <b>${fmt(all)}</b> items in progress, forecast ${horizon} EBITDA is <b>${fmt1(total)} m PLN</b> (${span}): ${part(ebP, nP, 'projects')} and ${part(ebI, nI, 'initiatives')}.`;
  },
  'pods.c4missing': (n, fromFile) =>
    ` <b>${fmt(n)}</b> ${en1(n, 'item has', 'items have')} no EBITDA ${fromFile ? 'in the business-value workbook' : 'in Jira'}, so ${en1(n, 'it is', 'they are')} not included in this total.`,

  'pods.scopeNote': (proj, init) =>
    `${fmt(proj)} ${en1(proj, 'project', 'projects')} · ${fmt(init)} ${en1(init, 'initiative', 'initiatives')}`,
  'pods.emptyProj': 'No projects in progress within the current selection.',
  'pods.emptyInit': 'No initiatives in progress within the current selection.',
  'pods.emptyBoth': 'Nothing in progress within the current selection.',

  /* ---- unit-membership control line ---- */
  'diag.units': 'Reporting units: ',
  'diag.unit': (name, field, values, n) =>
    `<b>${name}</b> — field ${field} contains ${values.map(v => `"${v}"`).join(' or ')} (${n ? `${fmt(n)} ${en1(n, 'issue', 'issues')}` : '<b>0 issues</b>'})`,
  'diag.overlap': n =>
    ` <b>${fmt(n)}</b> ${en1(n, 'issue belongs', 'issues belong')} to more than one unit — counted once across the whole portfolio, but counted in both when the units are totalled separately.`,
  'diag.dropped': n =>
    ` ${fmt(n)} ${en1(n, 'issue from Jira matches', 'issues from Jira match')} no rule and ${en1(n, 'is', 'are')} left out of the report.`,
  'diag.roadmapFrom': list =>
    ` Roadmap values came from: ${list} — keep only that ID in CFG.fields.roadmap.`,
  'diag.roadmapNone':
    ' <b>None of the configured Roadmap fields returned a value</b> — check CFG.fields.roadmap in js/config.js.',

  /* ---- RAG sentence ---- */
  'rag.noneProj': 'No projects in progress.',
  'rag.noneInit': 'No initiatives in progress.',
  'rag.sentence': (kind, n, green, amber, red, noRag) => {
    const noun = kind === 'proj' ? en1(n, 'project', 'projects') : en1(n, 'initiative', 'initiatives');
    let s = `Of <b>${fmt(n)}</b> ${noun} in progress, <b>${fmt(green)}</b> ${en1(green, 'is', 'are')} rated Green`;
    s += red ? `, <b>${fmt(amber)}</b> Amber and <b>${fmt(red)}</b> Red.`
             : ` and <b>${fmt(amber)}</b> Amber.`;
    if (noRag) s += ` ${fmt(noRag)} ${en1(noRag, 'has', 'have')} no RAG status set.`;
    return s;
  },
  'rag.ebitdaParts': parts => ` Forecast EBITDA: ${parts.join(', ')}.`,
  'rag.ebitdaPart': (name, v, share) => `${name} ${fmt(Math.round(v))} m PLN (${share})`,

  /* ---- structure page ---- */
  'str.lede': 'The portfolio covers items in Delivery, Analysis and Preparation. "In progress" means Delivery and Analysis together.',
  'str.matrixHead': 'Portfolio structure',
  'str.matrixHint': 'Click a row to narrow the detail list beside it.',
  'str.detailHead': 'Details',
  'str.running': 'In progress',
  'str.planned': 'Planned',
  'str.startBy': y => `Starting by end of ${y}`,
  'str.startFrom': y => `Starting ${y}`,
  'str.noStart': 'No start date',
  'str.emptyDetail': 'No items.',
  'str.soonHead': 'Upcoming starts',
  'str.soonNote': (from, to, n) => `${from} – ${to} · ${fmt(n)} ${en1(n, 'item', 'items')}`,
  'str.soonEmptyProj': 'No projects starting in this period.',
  'str.soonEmptyInit': 'No initiatives starting in this period.',
  'str.soonEmptyBoth': 'Nothing starting in this period.',
  'str.c1': (all, proj, init) =>
    `The portfolio holds <b>${fmt(all)}</b> ${en1(all, 'item', 'items')}: <b>${fmt(proj)}</b> ${en1(proj, 'project', 'projects')} and <b>${fmt(init)}</b> ${en1(init, 'initiative', 'initiatives')}.`,
  'str.c2': (running, planned) =>
    `<b>${fmt(running)}</b> ${en1(running, 'item is', 'items are')} currently in progress, while <b>${fmt(planned)}</b> ${en1(planned, 'remains', 'remain')} in planning.`,
  'str.c3': (total, proj, init, year) =>
    `Of the planned items, <b>${fmt(total)}</b> ${enIs(total)} due to start before the end of ${year}: <b>${fmt(proj)}</b> ${en1(proj, 'project', 'projects')} and <b>${fmt(init)}</b> ${en1(init, 'initiative', 'initiatives')}.`,
  'str.c3none': year => `None of the planned items is due to start before the end of ${year}.`,

  /* ---- business value page ---- */
  'war.lede': (horizon, span) =>
    `Forecast ${horizon} EBITDA of projects in progress (${span}), split by business category and planned completion year, set against the CAPEX and OPEX budget and against value already delivered.`,
  'war.catHead': 'Projects in progress by category',
  'war.catShares': 'shares',
  'war.catValues': 'amounts',
  'war.catWaiting': 'awaiting data from Jira',
  'war.yearHead': 'Projects in progress by planned completion year',
  'war.yearCol': 'Completion year',
  'war.noEndDate': 'No date',
  'war.doneHead': 'Projects in progress and completed',
  'war.group': 'Group',
  'war.groupRunning': 'In progress',
  'war.groupDoneYear': y => `Completed in ${y}`,
  'war.groupDoneRange': (a, b) => `Completed ${a}–${b}`,
  'war.groupDoneOlder': 'Completed earlier',
  'war.doneSrc': 'Completed projects are assigned to a year by their planned completion date — Jira does not record the actual closing date. In the original report the Total row of this table sums EBITDA across all groups but counts projects from the first two only; here everything is summed.',
  'war.compHead': 'Compliance projects generating positive EBITDA',
  'war.compWaiting': 'awaiting mapping',
  'war.compEmpty': 'No such projects within the current selection.',
  'war.compNoCat': 'This table needs the category from the business-value workbook.',
  'war.konceHead': y => `Projects due to complete in ${y}`,
  'war.konceEmpty': 'No projects completing this year.',
  'war.listHead': 'Projects in progress by value',
  'war.listNote': (n, total, missing) =>
    `${fmt(n)} ${en1(n, 'item', 'items')} · total ${fmt1(total)} m` + (missing ? ` · ${fmt(missing)} without a value` : ''),
  'war.listEmpty': 'No projects.',
  'war.ebitdaYear': y => `EBITDA ${y}`,

  'war.c1': (n, horizon, total, span) =>
    `<b>${fmt(n)}</b> ${en1(n, 'project in progress generates', 'projects in progress generate')} forecast ${horizon} EBITDA of <b>${fmt(Math.round(total))} m PLN</b> (${span})`,
  'war.c1missing': (missing, all) =>
    `; the remaining <b>${fmt(missing)}</b> of <b>${fmt(all)}</b> projects in progress have no value in the source.`,
  'war.c1years': parts => `Split by year: ${parts.join(', ')}.`,
  'war.c1year': (y, v) => `<b>${y}</b> ${fmt1(v)} m`,
  'war.cGrowthShare': (share, n, all) =>
    `Growth projects make up <b>${share}</b> of projects in progress (${fmt(n)} of ${fmt(all)}).`,
  'war.cGrowthEbitda': (share, horizon, v) =>
    `Growth projects generate <b>${share}</b> of the active portfolio's forecast ${horizon} EBITDA (${fmt(Math.round(v))} m PLN).`,
  'war.cGrowthCapex': share =>
    `<b>${share}</b> of the CAPEX budget for projects in progress goes to Growth projects.`,
  'war.cNoCat': 'The Growth / Compliance / Maintenance split is waiting for the business-value workbook or for a classification field in Jira. Until then category shares are not calculated.',
  'war.cBudget': (capex, opex) =>
    `Budget for projects in progress: CAPEX <b>${fmt1(capex)} m PLN</b>, OPEX <b>${fmt1(opex)} m PLN</b>.`,
  'war.cBudgetMissing': n =>
    ` ${fmt(n)} ${en1(n, 'project has', 'projects have')} no CAPEX filled in Jira.`,
  'war.cEbMissing': (n, fromFile) =>
    `<b>${fmt(n)}</b> ${en1(n, 'project has', 'projects have')} no EBITDA ${fromFile ? 'in the business-value workbook' : 'in Jira'}, so ${en1(n, 'it is', 'they are')} not included in the totals above.`,

  'war.srcFile': (file, years, horizon) =>
    `EBITDA comes from ${file}: the year columns ${years.join(', ')} and the "${horizon} EBITDA" column. The total is read from its own column rather than summed from the years — the workbook rounds each year, so the parts do not always add up to the figure it publishes. CAPEX and OPEX still come from Jira (fields CAPEX [K] and OPEX [K], in thousands of PLN). The workbook's EBITDA applies across the whole report: where an issue is absent from the workbook the report shows a dash rather than the Jira value, so that two different horizons never land in one total. This is a temporary arrangement — once the data team publishes its table only the source changes, the definitions stay.`,
  'war.srcJira': years =>
    `The Jira fields EBITDA [K], CAPEX [K] and OPEX [K] are in thousands of PLN. EBITDA is a combined ${years}-year forecast read straight from EBITDA [K], with no conversion. Jira holds no per-year split; that comes from the business-value workbook, which is not loaded right now.`,

  'war.catSrcFile': (file, note, years, horizon, covered, all, missing, zero) =>
    `Figures on this page come from <b>${file}</b> (${note}): EBITDA split across ${years.join(', ')} with a ${horizon} total, and the category from the Project Type column. The workbook holds thousands of PLN despite headers saying "(PLN)". Coverage: <b>${fmt(covered)}</b> of <b>${fmt(all)}</b> projects in progress ${enIs(covered)} in the workbook` +
    (zero
      ? `. <b>No issue number from the workbook matches the loaded data</b> — that is what a workbook of real numbers looks like next to demo data, which has its own. Coverage will be real once you connect to Jira.`
      : missing > 0
        ? `; the other <b>${fmt(missing)}</b> ${en1(missing, 'has', 'have')} no EBITDA here and ${en1(missing, 'is', 'are')} left out of the totals — the table shows a dash for them.`
        : '.') +
    ` The same workbook is the EBITDA source on every other page, so all totals in the report share one horizon.`,
  'war.catSrcNoFile': (reason, years, hasCat) =>
    `<b>The business-value workbook was not loaded.</b> ${reason} Until it is: EBITDA comes from the Jira field EBITDA [K] as a ${years}-year forecast with no per-year split, and categories ` +
    (hasCat
      ? 'are taken from the Project classification field in Jira (CFG.categoryMap in js/config.js) — if the table above shows nothing but zeros, that field is not on the PF issue screen.'
      : 'are switched off (fields.category = null in js/config.js), so the split cannot be calculated.') +
    ' Check the server console: refreshing the page should print a <code>/api/valuation -&gt; …</code> line.',

  /* ---- health page ---- */
  'kon.lede': 'Schedule compliance is the difference between the current and the original completion date. Tolerance ±30 days.',
  'kon.ragHead': 'Projects in progress by RAG status',
  'kon.onTime': (share, n, all) =>
    `<b>${share}</b> of the projects analysed ${enIs(n)} on schedule (${fmt(n)} of ${fmt(all)}).`,
  'kon.noBaseline': n =>
    ` ${fmt(n)} ${en1(n, 'project has', 'projects have')} no original plan in Jira and ${en1(n, 'is', 'are')} therefore not analysed.`,
  'kon.noAnalysed': 'No projects with an original schedule to analyse.',
  'kon.delayed': (share, n, months) =>
    `<b>${share}</b> of the projects analysed are behind the original schedule (${fmt(n)} ${en1(n, 'project', 'projects')}, by ${fmt(months)} ${en1(months, 'month', 'months')} on average).`,
  'kon.delayedThisYear': (n, year) =>
    ` ${fmt(n)} of those started in ${year}.`,
  'kon.delayedNoneThisYear': year => ` All of them started before ${year}.`,
  'kon.ahead': n =>
    ` ${fmt(n)} ${en1(n, 'project is', 'projects are')} finishing earlier than planned.`,
  'kon.noDelays': 'None of the projects analysed is behind its original schedule.',
  'kon.avgDuration': (year, months, bench, benchLabel, diffText, basedOn) =>
    `Projects started in ${year} have an average planned duration of <b>${months}</b> ${en1(months, 'month', 'months')}` +
    (bench !== null ? ` against <b>${bench}</b> ${en1(bench, 'month', 'months')} in the ${benchLabel} analysis (${diffText})` : '') +
    (basedOn !== null ? ` – based on ${fmt(basedOn)} ${en1(basedOn, 'project', 'projects')}.` : '.'),
  'kon.diffShorter': n => `${n} ${en1(n, 'month', 'months')} shorter`,
  'kon.diffLonger': n => `${n} ${en1(n, 'month', 'months')} longer`,
  'kon.diffSame': 'unchanged',
  'kon.benchFallback': 'December 2025',

  /* ---- strategy page ---- */
  'stg.lede': 'Links between portfolio items and strategic initiatives are maintained by the strategy team. Status and RAG come from Jira.',
  'stg.barsHead': 'Linked items per initiative',
  'stg.matrixHead': 'Link matrix',
  'stg.totalRow': 'Linked projects and initiatives',
  'stg.empty': 'No links within the current selection.',
  'stg.c1': (proj, init) =>
    `<b>${fmt(proj)}</b> ${en1(proj, 'project', 'projects')} and <b>${fmt(init)}</b> ${en1(init, 'initiative', 'initiatives')} support the delivery of strategic initiatives.`,
  'stg.c2': (running, prep, done) =>
    `<b>${fmt(running)}</b> ${enIs(running)} currently in progress and <b>${fmt(prep)}</b> ${enIs(prep)} in preparation` +
    (done ? `, while <b>${fmt(done)}</b> ${en1(done, 'has', 'have')} been completed` : '') + '.',
  'stg.c3': parts => `The strongest support goes to: ${parts.join(', ')}.`,
  'stg.c4': (n, names) =>
    `<b>${fmt(n)}</b> ${en1(n, 'initiative has', 'initiatives have')} no linked portfolio items: ${names.join(', ')}.`,
  'stg.c4none': 'Every strategic initiative has at least one linked portfolio item.',
  'stg.c5': n =>
    `<b>${fmt(n)}</b> ${en1(n, 'row in the workbook has', 'rows in the workbook have')} no issue number yet, so ${en1(n, 'it appears', 'they appear')} in the matrix without status or RAG and ${en1(n, 'is', 'are')} not counted in the project and initiative split above.`,

  'stg.upload': 'Upload a new version',
  'stg.uploading': 'Reading…',
  'stg.uploadedAt': (date, who) =>
    ` · uploaded ${date}` + (who ? ` by ${who}` : ''),
  'stg.uploadStale': days =>
    ` · <b>matrix is ${fmt(days)} ${en1(days, 'day', 'days')} old</b> — check whether the strategy team has a newer version`,
  'stg.uploadOk': (rows, links) =>
    `Matrix loaded: ${fmt(rows)} ${en1(rows, 'row', 'rows')}, ${fmt(links)} ${en1(links, 'link', 'links')}.`,
  'stg.uploadFailed': err => `Not loaded: ${err}`,
  'stg.uploadNoServer': 'Uploading needs the server — start the application through serve.ps1.',

  /* ---- column filters ---- */
  'tf.search': 'Search values…',
  'tf.searchAria': col => `Search in column ${col}`,
  'tf.selectAll': 'Select all',
  'tf.clearColumn': 'Clear column filter',
  'tf.noMatches': 'No values match your search.',
  'tf.empty': '(blank)',
  'tf.allHidden': 'Column filters have hidden every row.',
  'tf.hidden': (hidden, total) => ` · ${fmt(hidden)} of ${fmt(total)} hidden `,
  'tf.clearAll': n => `clear filters (${n})`,
  'tf.filterCol': col => `Filter column ${col}`,
  'tf.filterTitle': 'Filter column',
  'tf.sortCol': col => `Sort by column ${col}`,

  /* ---- messages ---- */
  'msg.noIssues': 'Jira returned no issues for this query.',
  'msg.needCreds': 'Enter your e-mail address and API token.',
  'msg.authFailed': 'Jira rejected the sign-in (check the e-mail address and token).',
  'msg.httpError': code => `Jira returned error ${code}.`,
  'msg.cors': `<b>The browser blocked the connection to Jira.</b> Atlassian does not allow API calls
     straight from a web page — this is the CORS rule, and it is unrelated to your token or your
     network. The connection will work once the application runs on a company server that forwards
     the request. For now use <b>Demo data</b> or <b>Paste JSON export</b>.`,
  'msg.insecure': `<b>This connection is not encrypted.</b> The page is served over HTTP, so your API
      token travels as plain text and anyone who can see the network traffic can read it. An Atlassian
      token grants full access to your account, not just read access to project PF. Create a token for
      this dashboard alone and revoke it when you no longer need it. The server needs an HTTPS
      certificate before this goes into real use.`,
  'msg.pasteIntro': `<b>Import a Jira export.</b> Paste the response body from /rest/api/3/search/jql.
    If the portfolio did not fit on one page, paste the chunks one after another — they will be merged
    and duplicates dropped.`,
  'msg.pasteGo': 'Load',
  'msg.pasteFailed': err => `Could not read the data: ${err}`,
  'msg.refFailed': err => `<b>Could not load the reference data.</b> ${err}<br><br>
      If you opened the file by double-clicking it, run the application through the server instead:
      <code>powershell -ExecutionPolicy Bypass -File tools\\serve.ps1</code>, then open
      <code>http://localhost:8000</code>. See README.md for details.`,
  'msg.apiOld': 'js/api.js is from an older version (Api.loadValuation is missing). Replace it.',
  'msg.valNoteFull': i => i.kind === 'ok'
    ? `Excel · ${fmt(i.count)} ${en1(i.count, 'project', 'projects')}` +
      (i.sheets.length ? ` · ${i.sheets.join(' + ')}` : '') +
      (i.dups ? ` · ${fmt(i.dups)} ${en1(i.dups, 'duplicate', 'duplicates')} skipped` : '')
    : i.kind === 'noserver' ? 'The business-value workbook needs the server (serve.ps1).'
    : `Could not read the business-value workbook: ${i.err}`,
  'msg.refNoteFull': i => i.kind === 'ok'
    ? `Excel · ${fmt(i.rows)} ${en1(i.rows, 'row', 'rows')}` +
      (i.sheet ? ` · sheet "${i.sheet}"` : '') +
      (i.extras ? ` · ${fmt(i.extras)} without an issue number` : '')
    : `Could not read the Excel file — showing the backup copy. ${i.err}`,
  'msg.loadFailed': (path, code) => `Could not load ${path} (HTTP ${code}).`,
  'msg.pasteEmpty': 'The box is empty.',
  'msg.pasteNoIssues': 'No issues found (the "issues" field is missing).',
};

/* ===========================================================================
   LOOKUP
   =========================================================================== */

/**
 * Text for a key in the current language.
 *
 * A function entry is called with the remaining arguments; a string entry is
 * returned as it is. A key missing from the active language falls back to
 * Polish, and a key missing everywhere returns the key itself — visible in the
 * page, which is what you want: a missing translation should be obvious during
 * review rather than silently empty.
 *
 *   t('ui.total')                    -> 'Razem'
 *   t('pods.cardEnding', 2026)       -> 'Zakończenia projektów w 2026'
 */
function t(key, ...args) {
  const dict = I18N[LANG] || I18N.pl;
  const v = key in dict ? dict[key] : I18N.pl[key];
  if (v === undefined) return key;
  return typeof v === 'function' ? v(...args) : v;
}

/**
 * Switch language: remembers the choice, refills static markup, redraws.
 * Called by the switch in the top bar and once at boot.
 */
function setLang(code) {
  if (!LANGS.some(l => l.code === code)) code = 'pl';
  LANG = code;
  const def = LANGS.find(l => l.code === code);
  document.documentElement.lang = def.html;
  try { localStorage.setItem('dashLang', code); } catch (e) { /* storage blocked */ }

  document.querySelectorAll('#langSwitch button').forEach(b =>
    b.setAttribute('aria-pressed', b.dataset.lang === code));

  applyStaticText();
  // Only redraw once there is something to draw: setLang() also runs at boot,
  // before any dataset is loaded.
  if (typeof STATE !== 'undefined' && STATE.rows && STATE.rows.length) renderAll();
}

/**
 * Fill every element carrying data-i18n with the text for its key.
 * data-i18n-attr="placeholder" writes an attribute instead of the content,
 * which is how input placeholders and aria labels are translated.
 */
function applyStaticText() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const text = t(key);
    const attr = el.dataset.i18nAttr;
    if (attr) el.setAttribute(attr, text);
    else el.textContent = text;
  });
}

/** Language remembered from a previous visit, or the default. */
function initialLang() {
  try {
    const s = localStorage.getItem('dashLang');
    if (s && LANGS.some(l => l.code === s)) return s;
  } catch (e) { /* storage blocked */ }
  return (CFG && CFG.defaultLang) || 'pl';
}
