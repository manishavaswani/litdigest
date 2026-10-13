/* LitDigest — js/fetch.js
 * Digest engine: fetches recent works from OpenAlex (primary), Crossref
 * (supplement/fallback), and the arXiv API (optional preprint feeds).
 * Dedupe by DOI/title, relevance scoring vs user topics, concurrency-limited
 * fetching with progress callbacks and graceful per-source errors.
 * Exposed as window.LitDigestFetch. All builders/parsers are pure functions
 * so they can be smoke-tested under Node.
 */
(function (global) {
  'use strict';

  var OPENALEX_BASE = 'https://api.openalex.org';
  var CROSSREF_BASE = 'https://api.crossref.org';
  var ARXIV_BASE = 'https://export.arxiv.org/api/query';
  /* Polite-pool placeholders — replace with your own email for production use. */
  var MAILTO = 'litdigest-app@example.com';

  var STOPWORDS = ('a an the and or of in on for to with by from at as is are was were be been ' +
    'its it this that these those their his her our your we you they he she i not no nor but ' +
    'study analysis approach model models results evidence based using use new toward towards ' +
    'between within across over under into about').split(' ');

  /* ---------------- date helpers ---------------- */

  function isoDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* {from, to} ISO date strings covering the last `days` days (inclusive). */
  function dateWindow(days, now) {
    var end = now ? new Date(now) : new Date();
    var start = new Date(end.getTime() - (days - 1) * 86400000);
    return { from: isoDate(start), to: isoDate(end) };
  }

  /* ---------------- URL builders ---------------- */

  function buildOpenAlexTopicUrl(topic, from, to, perPage) {
    var p = new URLSearchParams();
    p.set('search', topic);
    p.set('filter', 'from_publication_date:' + from + ',to_publication_date:' + to + ',type:article');
    p.set('per-page', String(perPage || 10));
    p.set('mailto', MAILTO);
    return OPENALEX_BASE + '/works?' + p.toString();
  }

  function buildOpenAlexJournalUrl(issn, from, to, perPage) {
    var p = new URLSearchParams();
    p.set('filter', 'primary_location.source.issn:' + issn + ',from_publication_date:' + from + ',to_publication_date:' + to);
    p.set('sort', 'publication_date:desc');
    p.set('per-page', String(perPage || 10));
    p.set('mailto', MAILTO);
    return OPENALEX_BASE + '/works?' + p.toString();
  }

  function buildCrossrefTopicUrl(topic, from, to, rows) {
    var p = new URLSearchParams();
    p.set('query.bibliographic', topic);
    p.set('filter', 'from-pub-date:' + from + ',until-pub-date:' + to + ',type:journal-article');
    p.set('rows', String(rows || 8));
    p.set('sort', 'published');
    p.set('order', 'desc');
    p.set('select', 'DOI,title,author,container-title,published,abstract,URL,ISSN,type,publisher');
    p.set('mailto', MAILTO);
    return CROSSREF_BASE + '/works?' + p.toString();
  }

  function buildCrossrefJournalUrl(issn, from, to, rows) {
    var p = new URLSearchParams();
    p.set('filter', 'from-pub-date:' + from + ',until-pub-date:' + to + ',type:journal-article');
    p.set('rows', String(rows || 10));
    p.set('sort', 'published');
    p.set('order', 'desc');
    p.set('select', 'DOI,title,author,container-title,published,abstract,URL,ISSN,type,publisher');
    p.set('mailto', MAILTO);
    return CROSSREF_BASE + '/journals/' + encodeURIComponent(issn) + '/works?' + p.toString();
  }

  function buildArxivUrl(cat, maxResults) {
    var p = new URLSearchParams();
    p.set('search_query', 'cat:' + cat);
    p.set('sortBy', 'submittedDate');
    p.set('sortOrder', 'descending');
    p.set('max_results', String(maxResults || 15));
    return ARXIV_BASE + '?' + p.toString();
  }

  /* arXiv's API sends no Access-Control-Allow-Origin header, so direct browser
   * fetches are CORS-blocked. We try direct first (works outside browsers and
   * if arXiv ever enables CORS), then fall back across public CORS relays. */
  var CORS_RELAYS = [
    function (url) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url); },
    function (url) { return 'https://api.cors.lol/?url=' + encodeURIComponent(url); },
    function (url) { return 'https://corsproxy.io/?url=' + encodeURIComponent(url); }
  ];

  function fetchArxivFeed(cat, maxResults) {
    var url = buildArxivUrl(cat, maxResults);
    var attempt = fetchText(url);
    CORS_RELAYS.forEach(function (relay) {
      attempt = attempt.catch(function () { return fetchText(relay(url)); });
    });
    return attempt.then(function (xml) {
      if (xml.indexOf('<entry>') === -1 && xml.indexOf('<feed') === -1) {
        throw new Error('unexpected response shape for arXiv ' + cat);
      }
      return xml;
    });
  }

  /* ---------------- normalizers ---------------- */

  function reconstructAbstract(inv) {
    if (!inv || typeof inv !== 'object') { return ''; }
    var positions = [];
    Object.keys(inv).forEach(function (word) {
      inv[word].forEach(function (pos) { positions.push([pos, word]); });
    });
    positions.sort(function (a, b) { return a[0] - b[0]; });
    return positions.map(function (p) { return p[1]; }).join(' ');
  }

  var HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#34': '"' };

  function decodeEntities(s) {
    return String(s || '').replace(/&(#?\w+);/g, function (m, ent) {
      return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, ent) ? HTML_ENTITIES[ent] : m;
    });
  }

  function stripHtml(s) {
    return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  }

  function truncate(s, n) {
    s = String(s || '').trim();
    if (s.length <= n) { return s; }
    var cut = s.slice(0, n);
    var last = cut.lastIndexOf(' ');
    return (last > n * 0.6 ? cut.slice(0, last) : cut) + '…';
  }

  function normalizeDoi(doi) {
    if (!doi) { return ''; }
    return String(doi).trim().toLowerCase()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
      .replace(/^doi:\s*/, '');
  }

  function normalizeTitle(t) {
    return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /* OpenAlex work -> paper */
  function parseOpenAlexWork(w, tags) {
    var loc = w.primary_location || {};
    var src = loc.source || {};
    var doi = normalizeDoi(w.doi);
    var oa = (w.open_access && w.open_access.oa_url) || '';
    return {
      id: w.id || doi || w.title || '',
      title: w.display_name || (w.title) || '',
      authors: (w.authorships || []).map(function (a) {
        return a.author && a.author.display_name;
      }).filter(Boolean),
      journal: src.display_name || '',
      issn: (src.issn && src.issn[0]) || src.issn_l || '',
      date: w.publication_date || '',
      doi: doi,
      url: doi ? 'https://doi.org/' + doi : (w.id || ''),
      oaUrl: oa,
      abstract: truncate(reconstructAbstract(w.abstract_inverted_index), 600),
      citedBy: w.cited_by_count || 0,
      source: 'openalex',
      isPreprint: src.type === 'repository',
      tags: tags || []
    };
  }

  /* Crossref work -> paper */
  function parseCrossrefWork(item, tags) {
    var doi = normalizeDoi(item.DOI);
    var dateParts = item.published && item.published['date-parts'] && item.published['date-parts'][0];
    var date = dateParts ? dateParts.map(function (n) { return String(n).padStart(2, '0'); }).join('-') : '';
    return {
      id: doi || (item.title && item.title[0]) || '',
      title: (item.title && item.title[0]) || '',
      authors: (item.author || []).map(function (a) {
        return [a.given, a.family].filter(Boolean).join(' ');
      }).filter(Boolean),
      journal: (item['container-title'] && item['container-title'][0]) || '',
      issn: (item.ISSN && item.ISSN[0]) || '',
      date: date,
      doi: doi,
      url: doi ? 'https://doi.org/' + doi : (item.URL || ''),
      oaUrl: '',
      abstract: truncate(stripHtml(item.abstract), 600),
      citedBy: 0,
      source: 'crossref',
      isPreprint: false,
      tags: tags || []
    };
  }

  /* Minimal arXiv Atom parser (regex-based; works in browser and Node). */
  function parseArxivFeed(xmlText, tags) {
    var papers = [];
    var entries = String(xmlText || '').split('<entry>').slice(1);
    entries.forEach(function (chunk) {
      chunk = chunk.split('</entry>')[0] || '';
      function tag(name) {
        var m = chunk.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>'));
        return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
      }
      var id = tag('id');
      var title = tag('title');
      if (!title) { return; }
      var authors = [];
      var authorRe = /<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g;
      var am;
      while ((am = authorRe.exec(chunk)) !== null) { authors.push(am[1].trim()); }
      var arxivId = id.replace(/^https?:\/\/arxiv\.org\/abs\//, '');
      var httpsId = id.replace(/^http:\/\//, 'https://');
      papers.push({
        id: httpsId,
        title: title,
        authors: authors,
        journal: 'arXiv preprint',
        issn: '',
        date: (tag('published') || '').slice(0, 10),
        doi: '',
        url: httpsId,
        oaUrl: httpsId,
        abstract: truncate(tag('summary'), 600),
        citedBy: 0,
        source: 'arxiv',
        isPreprint: true,
        arxivId: arxivId,
        tags: tags || []
      });
    });
    return papers;
  }

  /* ---------------- dedupe + relevance ---------------- */

  function dedupeKey(p) {
    if (p.doi) { return 'doi:' + p.doi; }
    var t = normalizeTitle(p.title);
    return t ? 't:' + t : 'id:' + p.id;
  }

  /* Merge duplicates in two phases: first by DOI, then by normalized title
   * (so a DOI-less Crossref hit merges into the DOI-bearing OpenAlex record).
   * Prefer the record with more information (abstract/authors), preferring
   * OpenAlex for equal quality. Union the tags. */
  function dedupe(papers) {
    var order = { openalex: 0, arxiv: 1, crossref: 2 };
    var quality = function (x) {
      return (x.abstract ? 2 : 0) + (x.authors && x.authors.length ? 1 : 0) - (order[x.source] || 0) * 0.1;
    };
    function mergeIntoMap(byKey, keyFn) {
      var out = new Map();
      var anon = 0;
      byKey.forEach(function (p) {
        var k = keyFn(p);
        if (!k) { // no usable key for this phase — keep under a unique key
          out.set('anon:' + (anon++), p);
          return;
        }
        if (!out.has(k)) { out.set(k, p); return; }
        var cur = out.get(k);
        var keep = quality(p) > quality(cur) ? p : cur;
        var drop = keep === p ? cur : p;
        keep.tags = Array.from(new Set((keep.tags || []).concat(drop.tags || [])));
        if (!keep.doi && drop.doi) { keep.doi = drop.doi; keep.url = keep.url || 'https://doi.org/' + drop.doi; }
        if (!keep.abstract && drop.abstract) { keep.abstract = drop.abstract; }
        out.set(k, keep);
      });
      return out;
    }
    var byDoi = mergeIntoMap(new Map(papers.map(function (p) { return [p.id + '|' + dedupeKey(p), p]; })), function (p) {
      return p.doi ? 'doi:' + p.doi : '';
    });
    var byTitle = mergeIntoMap(byDoi, function (p) {
      var t = normalizeTitle(p.title);
      return t ? 't:' + t : '';
    });
    return Array.from(byTitle.values());
  }

  function topicTerms(topics) {
    var terms = [];
    (topics || []).forEach(function (t) {
      String(t).toLowerCase().split(/[^a-z0-9]+/).forEach(function (tok) {
        if (tok.length > 2 && STOPWORDS.indexOf(tok) === -1 && terms.indexOf(tok) === -1) {
          terms.push(tok);
        }
      });
    });
    return terms;
  }

  /* Relevance 0-100: phrase hit in title (40) / abstract (15),
   * token overlap in title (8/token) and abstract (3/token), citation bonus. */
  function scoreRelevance(paper, topics) {
    var title = ' ' + normalizeTitle(paper.title) + ' ';
    var abs = ' ' + normalizeTitle(paper.abstract) + ' ';
    var score = 0;
    (topics || []).forEach(function (t) {
      var phrase = normalizeTitle(t);
      if (!phrase) { return; }
      if (title.indexOf(' ' + phrase + ' ') !== -1) { score += 40; }
      else if (abs.indexOf(' ' + phrase + ' ') !== -1) { score += 15; }
    });
    topicTerms(topics).forEach(function (tok) {
      if (title.indexOf(' ' + tok + ' ') !== -1) { score += 8; }
      else if (abs.indexOf(' ' + tok + ' ') !== -1) { score += 3; }
    });
    if (paper.citedBy > 50) { score += 5; }
    else if (paper.citedBy > 5) { score += 2; }
    return Math.min(100, score);
  }

  /* ---------------- fetch orchestration ---------------- */

  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) {
        var err = new Error('HTTP ' + r.status + ' from ' + url.split('?')[0]);
        err.status = r.status;
        throw err;
      }
      return r.json();
    });
  }

  function fetchText(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) {
        var err = new Error('HTTP ' + r.status + ' from ' + url.split('?')[0]);
        err.status = r.status;
        throw err;
      }
      return r.text();
    });
  }

  /* Simple concurrency pool. tasks: [() => Promise]. onEach(i, error?) after each settles. */
  function runPool(tasks, limit, onEach) {
    var results = new Array(tasks.length);
    var next = 0;
    function worker() {
      if (next >= tasks.length) { return Promise.resolve(); }
      var i = next++;
      return tasks[i]()
        .then(function (res) { results[i] = { ok: true, value: res }; })
        .catch(function (err) { results[i] = { ok: false, error: err }; })
        .then(function () {
          if (onEach) { onEach(i, results[i]); }
          return worker();
        });
    }
    var workers = [];
    for (var k = 0; k < Math.min(limit, tasks.length); k++) { workers.push(worker()); }
    return Promise.all(workers).then(function () { return results; });
  }

  /* Run the full digest.
   * config: { topics:[], journals:[{name,issns}], arxivCats:[], days }
   * onProgress({done, total, label}) called as tasks settle.
   * Returns { papers, sections, stats, errors, generatedAt, window } */
  function runDigest(config, onProgress) {
    var win = dateWindow(config.days);
    var topics = (config.topics || []).filter(Boolean);
    var journals = (config.journals || []).filter(function (j) { return j.issns && j.issns.length; });
    var cats = (config.arxivCats || []).filter(Boolean);
    var trackedIssns = new Set();
    journals.forEach(function (j) { j.issns.forEach(function (i) { trackedIssns.add(i.toLowerCase()); }); });

    var tasks = [];
    var labels = [];

    journals.forEach(function (j) {
      labels.push(j.name);
      tasks.push(function () {
        return fetchJson(buildOpenAlexJournalUrl(j.issns[0], win.from, win.to, 10))
          .then(function (data) {
            return (data.results || []).map(function (w) {
              return parseOpenAlexWork(w, ['journal:' + j.name]);
            });
          })
          .catch(function (oaErr) {
            // Crossref fallback for this journal
            return fetchJson(buildCrossrefJournalUrl(j.issns[0], win.from, win.to, 10))
              .then(function (data) {
                return ((data.message && data.message.items) || []).map(function (it) {
                  return parseCrossrefWork(it, ['journal:' + j.name, 'fallback:crossref']);
                });
              })
              .catch(function (crErr) {
                var e = new Error(j.name + ': OpenAlex (' + oaErr.message + ') and Crossref (' + crErr.message + ') both failed');
                e.sources = [oaErr.message, crErr.message];
                throw e;
              });
          });
      });
    });

    topics.forEach(function (t) {
      labels.push('topic: ' + t);
      tasks.push(function () {
        return fetchJson(buildOpenAlexTopicUrl(t, win.from, win.to, 10))
          .then(function (data) {
            return (data.results || []).map(function (w) { return parseOpenAlexWork(w, ['topic:' + t]); });
          });
      });
      labels.push('topic supplement (Crossref): ' + t);
      tasks.push(function () {
        return fetchJson(buildCrossrefTopicUrl(t, win.from, win.to, 6))
          .then(function (data) {
            return ((data.message && data.message.items) || []).map(function (it) {
              return parseCrossrefWork(it, ['topic:' + t, 'supplement:crossref']);
            });
          });
      });
    });

    cats.forEach(function (c) {
      labels.push('arXiv ' + c);
      tasks.push(function () {
        return fetchArxivFeed(c, 15)
          .then(function (xml) { return parseArxivFeed(xml, ['arxiv:' + c]); });
      });
    });

    var done = 0;
    var errors = [];
    if (!tasks.length) {
      return Promise.resolve({ papers: [], sections: { journals: [], topics: [], preprints: [] }, stats: null, errors: ['Nothing to fetch — add at least one topic, journal, or arXiv category.'], generatedAt: new Date().toISOString(), window: win });
    }

    return runPool(tasks, 3, function (i, res) {
      done++;
      if (!res.ok) { errors.push(labels[i] + ' — ' + res.error.message); }
      if (onProgress) { onProgress({ done: done, total: tasks.length, label: labels[i], ok: res.ok }); }
    }).then(function (results) {
      var all = [];
      results.forEach(function (r) { if (r.ok && Array.isArray(r.value)) { all = all.concat(r.value); } });
      var papers = dedupe(all);

      // Section assignment
      var sectionJournals = [];
      var sectionTopics = [];
      var sectionPreprints = [];
      papers.forEach(function (p) {
        p.score = scoreRelevance(p, topics);
        var fromTracked = (p.tags || []).some(function (t) { return t.indexOf('journal:') === 0; }) ||
          (p.issn && trackedIssns.has(String(p.issn).toLowerCase()));
        if (p.isPreprint || p.source === 'arxiv') {
          sectionPreprints.push(p);
        } else if (fromTracked) {
          sectionJournals.push(p);
        } else {
          sectionTopics.push(p);
        }
      });

      sectionJournals.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      sectionPreprints.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      sectionTopics.sort(function (a, b) {
        if (b.score !== a.score) { return b.score - a.score; }
        return (b.date || '').localeCompare(a.date || '');
      });

      // Only keep genuinely relevant topic papers (score floor) so the
      // "trending" section does not fill with off-topic Crossref hits.
      sectionTopics = sectionTopics.filter(function (p) { return p.score >= 8; });

      var caps = { journals: 12, topics: 10, preprints: 8 };
      var sections = {
        journals: sectionJournals.slice(0, caps.journals),
        topics: sectionTopics.slice(0, caps.topics),
        preprints: sectionPreprints.slice(0, caps.preprints)
      };

      // Stats
      var journalCount = new Map();
      sections.journals.concat(sections.topics).forEach(function (p) {
        if (p.journal) { journalCount.set(p.journal, (journalCount.get(p.journal) || 0) + 1); }
      });
      var topJournals = Array.from(journalCount.entries())
        .sort(function (a, b) { return b[1] - a[1]; })
        .slice(0, 5)
        .map(function (e) { return { name: e[0], count: e[1] }; });
      var totalPapers = sections.journals.length + sections.topics.length + sections.preprints.length;
      var stats = {
        totalPapers: totalPapers,
        journalCount: journalCount.size,
        topJournals: topJournals,
        from: win.from,
        to: win.to,
        days: config.days
      };

      return {
        papers: sections.journals.concat(sections.topics, sections.preprints),
        sections: sections,
        stats: stats,
        errors: errors,
        generatedAt: new Date().toISOString(),
        window: win
      };
    });
  }

  global.LitDigestFetch = {
    OPENALEX_BASE: OPENALEX_BASE,
    CROSSREF_BASE: CROSSREF_BASE,
    ARXIV_BASE: ARXIV_BASE,
    dateWindow: dateWindow,
    buildOpenAlexTopicUrl: buildOpenAlexTopicUrl,
    buildOpenAlexJournalUrl: buildOpenAlexJournalUrl,
    buildCrossrefTopicUrl: buildCrossrefTopicUrl,
    buildCrossrefJournalUrl: buildCrossrefJournalUrl,
    buildArxivUrl: buildArxivUrl,
    fetchArxivFeed: fetchArxivFeed,
    reconstructAbstract: reconstructAbstract,
    parseOpenAlexWork: parseOpenAlexWork,
    parseCrossrefWork: parseCrossrefWork,
    parseArxivFeed: parseArxivFeed,
    normalizeDoi: normalizeDoi,
    normalizeTitle: normalizeTitle,
    dedupe: dedupe,
    scoreRelevance: scoreRelevance,
    topicTerms: topicTerms,
    runPool: runPool,
    runDigest: runDigest,
    truncate: truncate
  };
})(typeof window !== 'undefined' ? window : globalThis);
