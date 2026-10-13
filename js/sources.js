/* LitDigest — js/sources.js
 * Journal resolution: the user pastes a journal name, an ISSN, or a URL
 * (journal homepage / Scopus-SJR / portal.issn.org / publisher page) and the
 * app resolves it to a concrete journal record via the OpenAlex sources API
 * so the user can confirm the exact match before tracking it.
 * Exposed as window.LitDigestSources.
 *
 * Note: ResearchGate and most publisher sites block programmatic scraping.
 * Resolution therefore goes through OpenAlex (https://docs.openalex.org),
 * which indexes those journals — the user confirms the matched source.
 */
(function (global) {
  'use strict';

  var OPENALEX_BASE = 'https://api.openalex.org';
  /* Polite-pool placeholder — replace with your own email for production use. */
  var MAILTO = 'litdigest-app@example.com';

  var ISSN_RE = /^\d{4}-\d{3}[\dXx]$/;

  function isIssn(s) { return ISSN_RE.test(String(s || '').trim()); }

  function looksLikeUrl(s) {
    return /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(String(s || '').trim()) && /\./.test(s);
  }

  /* Extract a candidate ISSN embedded in a URL, e.g.
   * portal.issn.org/resource/ISSN/0001-4273, scimagojr links, publisher pages. */
  function issnFromUrl(url) {
    var m = String(url || '').match(/(\d{4}-\d{3}[\dXx])/);
    return m ? m[1] : null;
  }

  /* Turn a URL into a search phrase: meaningful hostname + path tokens.
   * e.g. https://onlinelibrary.wiley.com/journal/10970266 -> "10970266" tokens
   * plus site hint; OpenAlex search handles journal-name fragments well. */
  function urlToSearchTerms(url) {
    var issn = issnFromUrl(url);
    if (issn) { return issn; }
    try {
      var u = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url);
      var bits = (u.pathname + ' ' + u.hostname.replace(/^www\./, ''))
        .split(/[^a-zA-Z0-9]+/)
        .filter(function (t) {
          return t.length > 2 &&
            ['com', 'org', 'net', 'edu', 'http', 'https', 'www', 'journal', 'journals', 'home', 'index', 'en', 'html'].indexOf(t.toLowerCase()) === -1;
        });
      return bits.slice(0, 8).join(' ');
    } catch (e) {
      return String(url);
    }
  }

  function authParams(extra) {
    var p = new URLSearchParams(extra || {});
    p.set('mailto', MAILTO);
    return p.toString();
  }

  function normalizeSource(s) {
    if (!s) { return null; }
    var issns = [];
    if (Array.isArray(s.issn)) { issns = s.issn.slice(); }
    else if (s.issn_l) { issns = [s.issn_l]; }
    // Ensure the linking ISSN is present.
    if (s.issn_l && issns.indexOf(s.issn_l) === -1) { issns.unshift(s.issn_l); }
    return {
      id: s.id || '',
      name: s.display_name || '',
      issns: issns,
      publisher: (s.host_organization_name) || '',
      homepage: s.homepage_url || '',
      worksCount: s.works_count || 0,
      type: s.type || '',
      isInDoaj: !!s.is_in_doaj
    };
  }

  /* Resolve any user input (name / ISSN / URL) to a list of candidate
   * journals for confirmation. Returns Promise<candidate[]>. */
  function resolveJournal(input) {
    var raw = String(input || '').trim();
    if (!raw) { return Promise.resolve([]); }

    var directIssn = isIssn(raw) ? raw : (looksLikeUrl(raw) ? issnFromUrl(raw) : null);

    if (directIssn) {
      return fetch(OPENALEX_BASE + '/sources/issn:' + encodeURIComponent(directIssn) + '?' + authParams())
        .then(function (r) {
          if (r.status === 404) { return []; }
          if (!r.ok) { throw new Error('OpenAlex returned HTTP ' + r.status + ' while looking up ISSN ' + directIssn); }
          return r.json();
        })
        .then(function (j) {
          var one = normalizeSource(j);
          if (!one) { return []; }
          return [one];
        });
    }

    var query = looksLikeUrl(raw) ? urlToSearchTerms(raw) : raw;
    return fetch(OPENALEX_BASE + '/sources?' + authParams({
      search: query,
      filter: 'type:journal',
      'per-page': '6'
    }))
      .then(function (r) {
        if (!r.ok) { throw new Error('OpenAlex returned HTTP ' + r.status + ' while searching sources'); }
        return r.json();
      })
      .then(function (j) {
        return (j.results || []).map(normalizeSource).filter(Boolean);
      });
  }

  global.LitDigestSources = {
    OPENALEX_BASE: OPENALEX_BASE,
    isIssn: isIssn,
    looksLikeUrl: looksLikeUrl,
    issnFromUrl: issnFromUrl,
    urlToSearchTerms: urlToSearchTerms,
    resolveJournal: resolveJournal
  };
})(typeof window !== 'undefined' ? window : globalThis);
