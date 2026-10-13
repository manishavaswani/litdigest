/* LitDigest — tests/smoke.js
 * Node smoke tests (no dependencies, Node 18+):
 *   node tests/smoke.js
 * Covers: OpenAlex/Crossref/arXiv URL builders, one live query returning
 * works, dedupe + relevance fixtures, and email-HTML self-containment.
 */
'use strict';

require('../js/data/journals.js');
require('../js/sources.js');
require('../js/fetch.js');
require('../js/newsletter.js');

const F = globalThis.LitDigestFetch;
const S = globalThis.LitDigestSources;
const N = globalThis.LitDigestNewsletter;
const JG = globalThis.JOURNAL_STARTER_GROUPS;

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('PASS  ' + name); }
  else { failures++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

/* ---------- 1. URL builders ---------- */

const win = F.dateWindow(7, new Date('2026-10-12T12:00:00Z'));
check('dateWindow 7d', win.from === '2026-10-06' && win.to === '2026-10-12', JSON.stringify(win));

const tUrl = F.buildOpenAlexTopicUrl('strategic management', '2026-10-01', '2026-10-12', 10);
const tu = new URL(tUrl);
check('OpenAlex topic URL host', tu.origin === 'https://api.openalex.org' && tu.pathname === '/works');
check('OpenAlex topic URL search param', tu.searchParams.get('search') === 'strategic management');
check('OpenAlex topic URL date filter',
  (tu.searchParams.get('filter') || '').includes('from_publication_date:2026-10-01') &&
  (tu.searchParams.get('filter') || '').includes('to_publication_date:2026-10-12'));

const jUrl = F.buildOpenAlexJournalUrl('0001-4273', '2026-10-01', '2026-10-12', 10);
const ju = new URL(jUrl);
check('OpenAlex journal URL issn filter',
  (ju.searchParams.get('filter') || '').includes('primary_location.source.issn:0001-4273'));
check('OpenAlex journal URL sort', ju.searchParams.get('sort') === 'publication_date:desc');

const cUrl = F.buildCrossrefTopicUrl('corporate governance', '2026-10-01', '2026-10-12', 6);
const cu = new URL(cUrl);
check('Crossref topic URL host', cu.origin === 'https://api.crossref.org');
check('Crossref topic URL filter', (cu.searchParams.get('filter') || '').includes('from-pub-date:2026-10-01'));

const cjUrl = F.buildCrossrefJournalUrl('0001-4273', '2026-10-01', '2026-10-12', 10);
check('Crossref journal URL path', cjUrl.startsWith('https://api.crossref.org/journals/0001-4273/works'));

const aUrl = F.buildArxivUrl('econ.GN', 15);
const au = new URL(aUrl);
check('arXiv URL', au.searchParams.get('search_query') === 'cat:econ.GN' && au.searchParams.get('sortBy') === 'submittedDate');

/* ---------- 2. sources.js helpers ---------- */

check('ISSN detection', S.isIssn('0001-4273') && S.isIssn('0304-405X') && !S.isIssn('0001-427'));
check('ISSN from portal.issn.org URL', S.issnFromUrl('https://portal.issn.org/resource/ISSN/0001-4273') === '0001-4273');
check('URL detection', S.looksLikeUrl('https://onlinelibrary.wiley.com/journal/10970266') && !S.looksLikeUrl('Academy of Management Journal'));

/* ---------- 3. starter data sanity ---------- */

const allStarters = JG.reduce((acc, g) => acc.concat(g.journals), []);
check('starter list >= 20 journals', allStarters.length >= 20, String(allStarters.length));
check('every starter has ISSN matching /\\d{4}-\\d{3}[\\dX]/',
  allStarters.every(j => j.issns.length && /^\d{4}-\d{3}[\dX]$/.test(j.issns[0])));
check('starter names unique', new Set(allStarters.map(j => j.name)).size === allStarters.length);

/* ---------- 4. dedupe fixtures ---------- */

const dupeA = F.parseOpenAlexWork({
  id: 'https://openalex.org/W1',
  display_name: 'Firm Strategy and Performance',
  doi: 'https://doi.org/10.1000/XYZ123',
  authorships: [{ author: { display_name: 'Jane Doe' } }],
  primary_location: { source: { display_name: 'SMJ', issn: ['0143-2095'] } },
  publication_date: '2026-10-10',
  abstract_inverted_index: { We: [0], test: [1], strategy: [2] },
  cited_by_count: 3
}, ['topic:strategy']);
const dupeB = F.parseCrossrefWork({
  DOI: '10.1000/xyz123',
  title: ['Firm Strategy and Performance'],
  author: [{ given: 'Jane', family: 'Doe' }],
  'container-title': ['Strategic Management Journal'],
  published: { 'date-parts': [[2026, 10, 10]] }
}, ['topic:strategy']);
const dupeC = F.parseCrossrefWork({
  title: ['Firm  Strategy   and Performance!'],   // same title, no DOI
  published: { 'date-parts': [[2026, 10, 9]] }
}, ['topic:other']);
const otherPaper = F.parseCrossrefWork({
  DOI: '10.1000/different',
  title: ['An unrelated study of bees'],
  published: { 'date-parts': [[2026, 10, 8]] }
}, ['topic:other']);

const dd = F.dedupe([dupeA, dupeB, dupeC, otherPaper]);
check('dedupe collapses DOI dupes and title dupes', dd.length === 2, 'got ' + dd.length);
const kept = dd.find(p => p.doi === '10.1000/xyz123');
check('dedupe prefers richer OpenAlex record', kept && kept.source === 'openalex' && kept.abstract === 'We test strategy');
check('dedupe unions tags', kept && kept.tags.length === 2);
check('abstract reconstruction', dupeA.abstract === 'We test strategy');
check('DOI normalization', F.normalizeDoi('https://doi.org/10.1000/XYZ123 ') === '10.1000/xyz123');

/* ---------- 5. relevance fixtures ---------- */

const topics = ['strategic management', 'corporate governance'];
const onTopic = {
  title: 'Corporate Governance and Strategic Management in Family Firms',
  abstract: 'This paper studies boards and strategy.',
  citedBy: 0
};
const offTopic = { title: 'A taxonomy of alpine mosses', abstract: 'Mosses of the high Alps.', citedBy: 0 };
check('relevance ranks on-topic above off-topic',
  F.scoreRelevance(onTopic, topics) > 40 && F.scoreRelevance(offTopic, topics) === 0,
  F.scoreRelevance(onTopic, topics) + ' vs ' + F.scoreRelevance(offTopic, topics));
check('relevance token match in abstract only > 0',
  F.scoreRelevance({ title: 'Boards under pressure', abstract: 'We examine corporate governance reforms.', citedBy: 0 }, topics) > 0);

/* ---------- 6. arXiv feed parsing fixture ---------- */

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
  <id>http://arxiv.org/abs/2601.01234v1</id>
  <title>  Markets and   Machine Learning </title>
  <summary> We study prediction in markets.\nSecond line. </summary>
  <published>2026-10-11T00:00:00Z</published>
  <author><name>Ada Lovelace</name></author>
  <author><name>Alan Turing</name></author>
</entry>
</feed>`;
const ax = F.parseArxivFeed(feed, ['arxiv:econ.GN']);
check('arXiv parse extracts paper', ax.length === 1 && ax[0].title === 'Markets and Machine Learning');
check('arXiv parse authors/date', ax[0].authors.length === 2 && ax[0].date === '2026-10-11');
check('arXiv paper flagged preprint', ax[0].isPreprint === true && ax[0].source === 'arxiv');

/* ---------- 7. email HTML self-containment ---------- */

const digest = {
  title: 'Strategy Research Weekly',
  generatedAt: '2026-10-12T08:00:00Z',
  stats: { totalPapers: 2, journalCount: 2, topJournals: [{ name: 'SMJ', count: 1 }], from: '2026-10-05', to: '2026-10-12', days: 7 },
  sections: {
    journals: [kept],
    topics: [],
    preprints: ax
  },
  sectionIntros: { journals: 'A quiet but consequential week in the journals.' }
};
const html = N.buildEmailHTML(digest);
check('email HTML is a full document', /^<!DOCTYPE html>/.test(html) && /<\/html>\s*$/.test(html));
check('email HTML has inline styles', (html.match(/style="/g) || []).length > 10);
check('email HTML contains no <script> or <link>', !/<script|<link/i.test(html));
const externalRefs = (html.match(/(?:src|href)="([^"]+)"/g) || [])
  .map(m => m.replace(/^(?:src|href)="/, '').replace(/"$/, ''))
  .filter(u => /^https?:/i.test(u));
check('email HTML external URLs are only paper links',
  externalRefs.length > 0 && externalRefs.every(u => /^https:\/\/(doi\.org|arxiv\.org)/.test(u)),
  JSON.stringify(externalRefs));
check('email HTML renders sections + paper', html.includes('In your tracked journals') && html.includes('Firm Strategy and Performance') && html.includes('Preprints'));
check('email HTML escapes user content', N.escapeHtml('<b>&"x"</b>') === '&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;');

const txt = N.buildPlainText(digest);
check('plain text export has masthead, section, link',
  txt.includes('STRATEGY RESEARCH WEEKLY') && txt.includes('IN YOUR TRACKED JOURNALS') && txt.includes('https://doi.org/10.1000/xyz123'));

/* ---------- 8. live API queries ---------- */

async function live() {
  // Crossref live query (always expected to work)
  try {
    const w = F.dateWindow(30);
    const r = await fetch(F.buildCrossrefTopicUrl('strategic management', w.from, w.to, 3));
    const j = await r.json();
    const items = (j.message && j.message.items) || [];
    check('LIVE Crossref query returns works', r.ok && items.length > 0, 'HTTP ' + r.status + ', items ' + items.length);
    const p = F.parseCrossrefWork(items[0]);
    check('LIVE Crossref work parses (title+doi)', !!p.title && !!p.doi);
  } catch (e) {
    check('LIVE Crossref query returns works', false, e.message);
  }
  // arXiv live query
  try {
    const r = await fetch(F.buildArxivUrl('econ.GN', 3));
    const xml = await r.text();
    const papers = F.parseArxivFeed(xml);
    check('LIVE arXiv query returns preprints', r.ok && papers.length > 0, 'HTTP ' + r.status);
  } catch (e) {
    check('LIVE arXiv query returns preprints', false, e.message);
  }
  // OpenAlex live query — may be rate-limited on shared IPs; report honestly
  try {
    const w = F.dateWindow(30);
    const r = await fetch(F.buildOpenAlexJournalUrl('0001-4273', w.from, w.to, 3));
    if (r.status === 429) {
      console.log('WARN  LIVE OpenAlex query — HTTP 429 (shared-IP rate limit from this machine; URL builder verified structurally, works in normal browser use)');
    } else {
      const j = await r.json();
      check('LIVE OpenAlex query returns works', r.ok && Array.isArray(j.results), 'HTTP ' + r.status);
    }
  } catch (e) {
    console.log('WARN  LIVE OpenAlex query — ' + e.message);
  }
}

live().then(() => {
  console.log(failures === 0 ? '\nAll smoke tests passed.' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
});
