/* LitDigest — app.js
 * UI wiring: tabs, tracking setup (topics / journals / arXiv), digest
 * generation with progress, newsletter rendering, exports, history, settings.
 * Depends on: js/data/journals.js, js/sources.js, js/fetch.js, js/ai.js,
 * js/newsletter.js
 */
(function () {
  'use strict';

  var Sources = window.LitDigestSources;
  var Engine = window.LitDigestFetch;
  var AI = window.LitDigestAI;
  var NL = window.LitDigestNewsletter;
  var StarterGroups = window.JOURNAL_STARTER_GROUPS || [];
  var ArxivGroups = window.ARXIV_CATEGORY_GROUPS || [];

  var LS_SETTINGS = 'litdigest.settings.v1';
  var LS_HISTORY = 'litdigest.history.v1';
  var HISTORY_CAP = 12;

  /* ---------- tiny DOM helpers ---------- */

  function $(id) { return document.getElementById(id); }
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function setError(el, msg) {
    if (msg) { el.textContent = msg; show(el); } else { el.textContent = ''; hide(el); }
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function copyText(text, btn) {
    function done() {
      var old = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = old; }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* no-op */ }
      document.body.removeChild(ta);
    }
  }

  /* ---------- settings persistence ---------- */

  function defaultSettings() {
    return { newsletterTitle: 'Research Digest Weekly', topics: [], journals: [], arxivCats: [], days: 30 };
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(LS_SETTINGS);
      var s = raw ? JSON.parse(raw) : {};
      var d = defaultSettings();
      return {
        newsletterTitle: s.newsletterTitle || d.newsletterTitle,
        topics: Array.isArray(s.topics) ? s.topics : d.topics,
        journals: Array.isArray(s.journals) ? s.journals : d.journals,
        arxivCats: Array.isArray(s.arxivCats) ? s.arxivCats : d.arxivCats,
        days: [7, 14, 30, 90].indexOf(s.days) !== -1 ? s.days : d.days
      };
    } catch (e) { return defaultSettings(); }
  }

  function saveSettings() {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
    renderTrackingSummary();
  }

  var settings = loadSettings();
  var currentDigest = null; // digest object currently rendered

  /* ---------- tabs ---------- */

  function activateTab(name) {
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'panel-' + name);
    });
    if (history.replaceState) { history.replaceState(null, '', '#' + name); }
  }

  document.querySelectorAll('.tab-btn').forEach(function (b) {
    b.addEventListener('click', function () { activateTab(b.getAttribute('data-tab')); });
  });
  var initialHash = (location.hash || '').replace('#', '');
  if (['digest', 'sources', 'settings'].indexOf(initialHash) !== -1) { activateTab(initialHash); }

  /* ---------- topics ---------- */

  var topicsInput = $('topics-input');
  topicsInput.value = settings.topics.join('\n');

  function parseTopics(text) {
    return String(text || '').split(/[\n,;]+/).map(function (t) { return t.trim(); }).filter(Boolean);
  }

  var topicsTimer = null;
  topicsInput.addEventListener('input', function () {
    clearTimeout(topicsTimer);
    topicsTimer = setTimeout(function () {
      settings.topics = parseTopics(topicsInput.value);
      saveSettings();
      $('topics-count').textContent = settings.topics.length
        ? settings.topics.length + ' topic' + (settings.topics.length === 1 ? '' : 's') + ' tracked.'
        : '';
    }, 400);
  });
  $('topics-count').textContent = settings.topics.length ? settings.topics.length + ' topics tracked.' : '';

  /* ---------- tracked journals ---------- */

  function journalKey(j) { return (j.issns && j.issns[0] ? j.issns[0] : j.name).toLowerCase(); }

  function isTracked(name, issns) {
    var keys = settings.journals.map(journalKey);
    var candidateKeys = (issns && issns.length ? issns : [name]).map(function (s) { return String(s).toLowerCase(); });
    return settings.journals.some(function (j) {
      var jk = journalKey(j);
      return candidateKeys.indexOf(jk) !== -1 ||
        (j.issns || []).some(function (i) { return candidateKeys.indexOf(i.toLowerCase()) !== -1; });
    }) || keys.some(function (k) { return candidateKeys.indexOf(k) !== -1; });
  }

  function addJournal(j) {
    if (isTracked(j.name, j.issns)) { return false; }
    settings.journals.push({ name: j.name, issns: j.issns || [], publisher: j.publisher || '', id: j.id || '' });
    saveSettings();
    renderTracked();
    renderStarters();
    return true;
  }

  function removeJournal(idx) {
    settings.journals.splice(idx, 1);
    saveSettings();
    renderTracked();
    renderStarters();
  }

  function renderTracked() {
    var ul = $('tracked-list');
    ul.innerHTML = '';
    settings.journals.forEach(function (j, i) {
      var li = document.createElement('li');
      var left = document.createElement('span');
      var nm = document.createElement('span');
      nm.className = 'tracked-name';
      nm.textContent = j.name;
      left.appendChild(nm);
      if (j.issns && j.issns.length) {
        var meta = document.createElement('span');
        meta.className = 'tracked-meta';
        meta.textContent = 'ISSN ' + j.issns.join(' / ');
        left.appendChild(meta);
      }
      li.appendChild(left);
      var rm = document.createElement('button');
      rm.className = 'btn ghost small';
      rm.textContent = 'Remove';
      rm.addEventListener('click', function () { removeJournal(i); });
      li.appendChild(rm);
      ul.appendChild(li);
    });
    $('tracked-empty').style.display = settings.journals.length ? 'none' : '';
  }

  /* ---------- journal resolution ---------- */

  function renderCandidates(list) {
    var box = $('journal-candidates');
    box.innerHTML = '';
    if (!list.length) { hide(box); return; }
    list.forEach(function (c) {
      var card = document.createElement('div');
      card.className = 'candidate-card';
      var left = document.createElement('div');
      var nm = document.createElement('div');
      nm.className = 'candidate-name';
      nm.textContent = c.name;
      left.appendChild(nm);
      var meta = document.createElement('div');
      meta.className = 'candidate-meta';
      meta.textContent = [
        c.issns && c.issns.length ? 'ISSN ' + c.issns.join(' / ') : 'no ISSN on record',
        c.publisher || null,
        c.worksCount ? c.worksCount.toLocaleString() + ' works indexed' : null,
        c.isInDoaj ? 'open access (DOAJ)' : null
      ].filter(Boolean).join(' · ');
      left.appendChild(meta);
      card.appendChild(left);
      var btn = document.createElement('button');
      var already = isTracked(c.name, c.issns);
      btn.className = 'btn small' + (already ? ' ghost' : ' primary');
      btn.textContent = already ? 'Tracked' : 'Track this journal';
      btn.disabled = already;
      btn.addEventListener('click', function () {
        if (addJournal(c)) {
          btn.textContent = 'Tracked';
          btn.className = 'btn small ghost';
          btn.disabled = true;
          $('journal-resolve-status').textContent = 'Added "' + c.name + '" to your tracked journals.';
        }
      });
      card.appendChild(btn);
      box.appendChild(card);
    });
    show(box);
  }

  function resolveJournalQuery() {
    var q = $('journal-query').value.trim();
    setError($('sources-error'), '');
    if (!q) { setError($('sources-error'), 'Type a journal name, ISSN, or URL first.'); return; }
    var status = $('journal-resolve-status');
    status.textContent = 'Resolving via OpenAlex sources API…';
    hide($('journal-candidates'));
    Sources.resolveJournal(q).then(function (cands) {
      if (!cands.length) {
        status.textContent = 'No journal matched "' + q + '". Check the spelling, or paste the journal\'s ISSN or its portal.issn.org URL.';
        return;
      }
      status.textContent = cands.length === 1
        ? 'One match — confirm it is the journal you meant:'
        : cands.length + ' candidates — confirm the exact journal you meant:';
      renderCandidates(cands);
    }).catch(function (err) {
      status.textContent = '';
      setError($('sources-error'), 'Resolution failed: ' + err.message + ' (check your connection and try again)');
    });
  }

  $('journal-resolve').addEventListener('click', resolveJournalQuery);
  $('journal-query').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); resolveJournalQuery(); }
  });

  /* ---------- starter list ---------- */

  function renderStarters() {
    var host = $('starter-groups');
    host.innerHTML = '';
    StarterGroups.forEach(function (g) {
      var grp = document.createElement('div');
      grp.className = 'starter-group';
      var lbl = document.createElement('p');
      lbl.className = 'starter-group-label';
      lbl.textContent = g.field;
      grp.appendChild(lbl);
      var row = document.createElement('div');
      row.className = 'chip-row';
      g.journals.forEach(function (j) {
        var chip = document.createElement('button');
        var added = isTracked(j.name, j.issns);
        chip.className = 'chip' + (added ? ' added' : '');
        chip.textContent = added ? j.abbr + ' — tracked' : j.abbr;
        chip.title = j.name + ' — ' + j.publisher + ' (ISSN ' + j.issns.join(' / ') + ')';
        chip.disabled = added;
        chip.addEventListener('click', function () {
          addJournal(j);
        });
        row.appendChild(chip);
      });
      grp.appendChild(row);
      host.appendChild(grp);
    });
  }

  /* ---------- arXiv categories ---------- */

  function renderArxiv() {
    var host = $('arxiv-groups');
    host.innerHTML = '';
    ArxivGroups.forEach(function (g) {
      var grp = document.createElement('div');
      grp.className = 'starter-group';
      var lbl = document.createElement('p');
      lbl.className = 'starter-group-label';
      lbl.textContent = g.field;
      grp.appendChild(lbl);
      var row = document.createElement('div');
      row.className = 'chip-row';
      g.cats.forEach(function (c) {
        var on = settings.arxivCats.indexOf(c.code) !== -1;
        var chip = document.createElement('button');
        chip.className = 'chip' + (on ? ' on' : '');
        chip.textContent = c.label;
        chip.addEventListener('click', function () {
          var i = settings.arxivCats.indexOf(c.code);
          if (i === -1) { settings.arxivCats.push(c.code); } else { settings.arxivCats.splice(i, 1); }
          saveSettings();
          renderArxiv();
        });
        row.appendChild(chip);
      });
      grp.appendChild(row);
      host.appendChild(grp);
    });
    // Custom (non-curated) categories
    var customs = settings.arxivCats.filter(function (code) {
      return !ArxivGroups.some(function (g) { return g.cats.some(function (c) { return c.code === code; }); });
    });
    if (customs.length) {
      var grp = document.createElement('div');
      grp.className = 'starter-group';
      var lbl = document.createElement('p');
      lbl.className = 'starter-group-label';
      lbl.textContent = 'Custom';
      grp.appendChild(lbl);
      var row = document.createElement('div');
      row.className = 'chip-row';
      customs.forEach(function (code) {
        var chip = document.createElement('button');
        chip.className = 'chip on';
        chip.textContent = code + ' ×';
        chip.title = 'Click to remove';
        chip.addEventListener('click', function () {
          settings.arxivCats = settings.arxivCats.filter(function (c) { return c !== code; });
          saveSettings();
          renderArxiv();
        });
        row.appendChild(chip);
      });
      grp.appendChild(row);
      host.appendChild(grp);
    }
  }

  $('arxiv-add').addEventListener('click', function () {
    var v = $('arxiv-custom').value.trim();
    if (!/^[a-z\-]+(\.[A-Z]{2})?$/.test(v)) {
      setError($('sources-error'), 'That does not look like an arXiv category code (e.g. econ.GN, cs.CL, stat.ML).');
      return;
    }
    setError($('sources-error'), '');
    if (settings.arxivCats.indexOf(v) === -1) {
      settings.arxivCats.push(v);
      saveSettings();
      renderArxiv();
    }
    $('arxiv-custom').value = '';
  });

  /* ---------- tracking summary ---------- */

  function renderTrackingSummary() {
    var parts = [];
    parts.push(settings.journals.length + ' journal' + (settings.journals.length === 1 ? '' : 's'));
    parts.push(settings.topics.length + ' topic' + (settings.topics.length === 1 ? '' : 's'));
    if (settings.arxivCats.length) { parts.push(settings.arxivCats.length + ' arXiv feed' + (settings.arxivCats.length === 1 ? '' : 's')); }
    $('digest-tracking-summary').textContent = parts.join(' · ');
  }

  /* ---------- digest generation ---------- */

  var running = false;

  function setProgress(done, total) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    $('digest-progress-fill').style.width = pct + '%';
    $('digest-progress-label').textContent = done + ' / ' + total;
  }

  function collectConfig() {
    return {
      topics: settings.topics.slice(),
      journals: settings.journals.slice(),
      arxivCats: settings.arxivCats.slice(),
      days: settings.days
    };
  }

  function runDigest() {
    if (running) { return; }
    setError($('digest-error'), '');
    var config = collectConfig();
    if (!config.topics.length && !config.journals.length && !config.arxivCats.length) {
      setError($('digest-error'), 'Nothing to track yet — add at least one topic, journal, or arXiv category in the Sources & Topics tab.');
      return;
    }
    running = true;
    $('digest-run').disabled = true;
    show($('digest-progress-wrap'));
    setProgress(0, 1);
    $('digest-progress-detail').textContent = 'Starting…';
    hide($('digest-errors'));

    Engine.runDigest(config, function (p) {
      setProgress(p.done, p.total);
      $('digest-progress-detail').textContent = (p.ok ? 'Fetched ' : 'Failed ') + p.label;
    }).then(function (digest) {
      digest.title = settings.newsletterTitle;
      return maybeAddAiTakeaways(digest).then(function () { return digest; });
    }).then(function (digest) {
      renderDigestResult(digest);
      saveToHistory(digest);
    }).catch(function (err) {
      setError($('digest-error'), 'Digest failed: ' + err.message);
    }).then(function () {
      running = false;
      $('digest-run').disabled = false;
      hide($('digest-progress-wrap'));
      $('digest-progress-detail').textContent = '';
    });
  }

  /* If an AI endpoint is configured, write takeaways + section intros;
   * otherwise papers keep their abstract excerpts. */
  function maybeAddAiTakeaways(digest) {
    if (!AI.isConfigured()) { return Promise.resolve(digest); }
    var papers = digest.papers || [];
    if (!papers.length) { return Promise.resolve(digest); }
    $('digest-progress-detail').textContent = 'Writing AI takeaways…';
    show($('digest-progress-wrap'));
    var tasks = papers.map(function (p) {
      return function () {
        return AI.takeaway(p, settings.topics).then(function (t) { p.takeaway = t; });
      };
    });
    ['journals', 'topics', 'preprints'].forEach(function (key) {
      var sec = digest.sections[key];
      if (sec && sec.length) {
        tasks.push(function () {
          return AI.sectionIntro(NL.SECTION_META[key].heading, sec, settings.topics).then(function (t) {
            digest.sectionIntros = digest.sectionIntros || {};
            digest.sectionIntros[key] = t;
          });
        });
      }
    });
    var done = 0;
    return Engine.runPool(tasks, 2, function (i, res) {
      done++;
      setProgress(done, tasks.length);
      if (!res.ok) {
        // Graceful: keep the abstract excerpt for this paper.
        $('digest-progress-detail').textContent = 'AI takeaway failed for one item — kept abstract excerpt (' + res.error.message + ')';
      }
    }).then(function () { return digest; });
  }

  function renderDigestResult(digest) {
    currentDigest = digest;
    NL.renderDigest($('newsletter-output'), digest);
    show($('digest-results'));
    hide($('digest-empty'));
    var box = $('digest-errors');
    if (digest.errors && digest.errors.length) {
      box.className = 'fetch-errors';
      box.innerHTML = '';
      var head = document.createElement('strong');
      head.textContent = digest.errors.length + ' source' + (digest.errors.length === 1 ? '' : 's') + ' could not be fetched (the digest uses the rest):';
      box.appendChild(head);
      var ul = document.createElement('ul');
      digest.errors.forEach(function (e) {
        var li = document.createElement('li');
        li.textContent = e;
        ul.appendChild(li);
      });
      box.appendChild(ul);
      show(box);
    } else {
      hide(box);
    }
  }

  $('digest-run').addEventListener('click', runDigest);

  /* ---------- exports ---------- */

  $('digest-export-email').addEventListener('click', function () {
    if (!currentDigest) { return; }
    var html = NL.buildEmailHTML(currentDigest);
    var stamp = (currentDigest.generatedAt || '').slice(0, 10) || 'digest';
    download('litdigest-' + stamp + '.html', html, 'text/html;charset=utf-8');
    show($('digest-email-help'));
    $('digest-email-help').setAttribute('open', '');
  });

  $('digest-print').addEventListener('click', function () {
    if (!currentDigest) { return; }
    activateTab('digest');
    window.print();
  });

  $('digest-copy').addEventListener('click', function () {
    if (!currentDigest) { return; }
    copyText(NL.buildPlainText(currentDigest), this);
  });

  /* ---------- history ---------- */

  function loadHistory() {
    try {
      var raw = localStorage.getItem(LS_HISTORY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveToHistory(digest) {
    var hist = loadHistory();
    hist.unshift({
      id: 'd' + Date.now(),
      savedAt: new Date().toISOString(),
      title: digest.title,
      days: digest.stats ? digest.stats.days : settings.days,
      total: digest.stats ? digest.stats.totalPapers : 0,
      digest: digest
    });
    hist = hist.slice(0, HISTORY_CAP);
    try {
      localStorage.setItem(LS_HISTORY, JSON.stringify(hist));
    } catch (e) {
      // Quota pressure: drop oldest entries and retry once.
      hist = hist.slice(0, 6);
      try { localStorage.setItem(LS_HISTORY, JSON.stringify(hist)); } catch (e2) { /* give up quietly */ }
    }
    renderHistory();
  }

  function renderHistory() {
    var hist = loadHistory();
    var ul = $('history-list');
    ul.innerHTML = '';
    hist.forEach(function (h) {
      var li = document.createElement('li');
      var left = document.createElement('div');
      var t = document.createElement('div');
      t.textContent = h.title || 'Digest';
      left.appendChild(t);
      var meta = document.createElement('div');
      meta.className = 'history-meta';
      meta.textContent = NL.formatDate((h.savedAt || '').slice(0, 10)) + ' · last ' + h.days + ' days · ' + h.total + ' papers';
      left.appendChild(meta);
      li.appendChild(left);
      var btn = document.createElement('button');
      btn.className = 'btn small';
      btn.textContent = 'Load';
      btn.addEventListener('click', function () {
        renderDigestResult(h.digest);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      li.appendChild(btn);
      ul.appendChild(li);
    });
    $('history-empty').style.display = hist.length ? 'none' : '';
  }

  /* ---------- settings tab ---------- */

  var titleInput = $('newsletter-title');
  titleInput.value = settings.newsletterTitle;
  var titleTimer = null;
  titleInput.addEventListener('input', function () {
    clearTimeout(titleTimer);
    titleTimer = setTimeout(function () {
      settings.newsletterTitle = titleInput.value.trim() || 'Research Digest Weekly';
      saveSettings();
    }, 400);
  });

  $('digest-days').value = String(settings.days);
  $('digest-days').addEventListener('change', function () {
    settings.days = parseInt(this.value, 10);
    saveSettings();
  });

  function reflectAiSettings() {
    var s = AI.getSettings();
    $('ai-endpoint').value = s.endpoint;
    $('ai-model').value = s.model;
    $('ai-key').value = s.key;
    $('ai-status').textContent = AI.isConfigured()
      ? 'AI takeaways enabled for endpoint ' + s.endpoint + ' (model: ' + (s.model || 'gpt-4o-mini') + ').'
      : 'No AI key configured — digests will use abstract excerpts.';
  }

  $('ai-save').addEventListener('click', function () {
    AI.saveSettings({ endpoint: $('ai-endpoint').value, model: $('ai-model').value, key: $('ai-key').value });
    reflectAiSettings();
    setError($('settings-error'), '');
  });

  $('ai-clear').addEventListener('click', function () {
    AI.clearSettings();
    reflectAiSettings();
  });

  $('ai-test').addEventListener('click', function () {
    var st = $('ai-status');
    AI.saveSettings({ endpoint: $('ai-endpoint').value, model: $('ai-model').value, key: $('ai-key').value });
    st.textContent = 'Testing connection…';
    AI.chat('You are a connectivity probe. Reply with exactly: ok', 'Say ok.')
      .then(function (r) { st.textContent = 'Connection OK — endpoint responded: "' + r.slice(0, 60) + '"'; })
      .catch(function (e) { st.textContent = 'Connection failed: ' + e.message; });
  });

  /* ---------- config export / import ---------- */

  $('config-export').addEventListener('click', function () {
    var cfg = {
      app: 'litdigest',
      version: 1,
      newsletterTitle: settings.newsletterTitle,
      topics: settings.topics,
      journals: settings.journals,
      arxivCats: settings.arxivCats,
      days: settings.days
    };
    download('litdigest-config.json', JSON.stringify(cfg, null, 2), 'application/json');
    $('config-status').textContent = 'Config exported (AI key not included).';
  });

  $('config-import-btn').addEventListener('click', function () { $('config-import-file').click(); });

  $('config-import-file').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) { return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var cfg = JSON.parse(String(reader.result || ''));
        if (!cfg || typeof cfg !== 'object') { throw new Error('not a JSON object'); }
        if (typeof cfg.newsletterTitle === 'string') { settings.newsletterTitle = cfg.newsletterTitle; }
        if (Array.isArray(cfg.topics)) { settings.topics = cfg.topics.map(String); }
        if (Array.isArray(cfg.journals)) { settings.journals = cfg.journals.filter(function (j) { return j && j.name; }); }
        if (Array.isArray(cfg.arxivCats)) { settings.arxivCats = cfg.arxivCats.map(String); }
        if ([7, 14, 30, 90].indexOf(cfg.days) !== -1) { settings.days = cfg.days; }
        saveSettings();
        // Re-reflect everything
        topicsInput.value = settings.topics.join('\n');
        titleInput.value = settings.newsletterTitle;
        $('digest-days').value = String(settings.days);
        renderTracked();
        renderStarters();
        renderArxiv();
        $('config-status').textContent = 'Config imported: ' + settings.journals.length + ' journals, ' + settings.topics.length + ' topics.';
        setError($('settings-error'), '');
      } catch (e) {
        setError($('settings-error'), 'Import failed: ' + e.message);
      }
    };
    reader.onerror = function () { setError($('settings-error'), 'Could not read the file.'); };
    reader.readAsText(file);
    this.value = '';
  });

  /* ---------- init ---------- */

  renderTracked();
  renderStarters();
  renderArxiv();
  renderTrackingSummary();
  renderHistory();
  reflectAiSettings();
})();
