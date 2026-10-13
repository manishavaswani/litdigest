/* LitDigest — js/newsletter.js
 * Newsletter rendering and export formats.
 *  - renderDigest(): editorial in-app view (distinct from the utilitarian app UI)
 *  - buildEmailHTML(): single-file, inline-styled, email-client-friendly HTML
 *    (600px table layout; the only external URLs are links to the papers)
 *  - buildPlainText(): copy-all text version
 * Exposed as window.LitDigestNewsletter. buildEmailHTML / buildPlainText are
 * pure string functions so they can be smoke-tested under Node.
 */
(function (global) {
  'use strict';

  /* Email palette — the same tasteful low-saturation set as the app. */
  var C = {
    paper: '#faf6ef',
    raised: '#fffdf8',
    ink: '#35302a',
    inkSoft: '#6b6357',
    line: '#e2d9c9',
    accent: '#a4543a',
    accentDark: '#84422e',
    accentSoft: '#f3e4dc',
    serif: 'Georgia, "Times New Roman", serif',
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif'
  };

  var SECTION_META = {
    journals: { key: 'journals', heading: 'In your tracked journals' },
    topics:   { key: 'topics',   heading: 'Trending on your topics' },
    preprints:{ key: 'preprints',heading: 'Preprints' }
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatAuthors(authors, max) {
    if (!authors || !authors.length) { return ''; }
    var n = max || 4;
    var shown = authors.slice(0, n);
    var s = shown.join(', ');
    if (authors.length > n) { s += ', et al.'; }
    return s;
  }

  function formatDate(iso) {
    if (!iso) { return ''; }
    var d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    if (isNaN(d.getTime())) { return iso; }
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function paperLink(p) {
    return p.url || (p.doi ? 'https://doi.org/' + p.doi : '');
  }

  /* ---------------- in-app editorial rendering ---------------- */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text != null) { e.textContent = text; }
    return e;
  }

  function renderPaperCard(p) {
    var card = el('article', 'nl-card');
    if (p.journal) {
      var src = el('div', 'nl-card-source', p.journal);
      if (p.date) { src.appendChild(el('span', 'nl-card-date', formatDate(p.date))); }
      card.appendChild(src);
    }
    var link = paperLink(p);
    var title = el('h4', 'nl-card-title');
    if (link) {
      var a = el('a', null, p.title);
      a.href = link;
      a.target = '_blank';
      a.rel = 'noopener';
      title.appendChild(a);
    } else {
      title.textContent = p.title;
    }
    card.appendChild(title);
    var authors = formatAuthors(p.authors);
    if (authors) { card.appendChild(el('p', 'nl-card-authors', authors)); }
    var takeaway = p.takeaway || p.abstract;
    if (takeaway) {
      var tk = el('p', 'nl-card-takeaway', takeaway);
      card.appendChild(tk);
      if (!p.takeaway && p.abstract) {
        card.appendChild(el('p', 'nl-card-note', 'Abstract excerpt (add an AI key in Settings for editorial takeaways)'));
      }
    }
    if (link) {
      var read = el('a', 'nl-card-link', 'Read paper');
      read.href = link;
      read.target = '_blank';
      read.rel = 'noopener';
      if (p.oaUrl && p.oaUrl !== link) {
        var oa = el('a', 'nl-card-link', 'Open access');
        oa.href = p.oaUrl;
        oa.target = '_blank';
        oa.rel = 'noopener';
        card.appendChild(read);
        card.appendChild(oa);
      } else {
        card.appendChild(read);
      }
    }
    return card;
  }

  /* Render the digest into `container` (editorial newsletter look). */
  function renderDigest(container, digest) {
    container.innerHTML = '';
    container.classList.add('nl');

    var mast = el('div', 'nl-masthead');
    mast.appendChild(el('h3', 'nl-title', digest.title || 'Research Digest'));
    var dateline = formatDate(digest.generatedAt ? digest.generatedAt.slice(0, 10) : '') +
      (digest.stats ? ' · covering ' + formatDate(digest.stats.from) + ' – ' + formatDate(digest.stats.to) : '');
    mast.appendChild(el('p', 'nl-dateline', dateline));
    container.appendChild(mast);

    if (digest.stats) {
      var strip = el('div', 'nl-stats');
      strip.appendChild(el('span', 'nl-stat', digest.stats.totalPapers + ' new paper' + (digest.stats.totalPapers === 1 ? '' : 's')));
      strip.appendChild(el('span', 'nl-stat', 'across ' + digest.stats.journalCount + ' journal' + (digest.stats.journalCount === 1 ? '' : 's')));
      if (digest.stats.topJournals && digest.stats.topJournals.length) {
        strip.appendChild(el('span', 'nl-stat', 'Most active: ' +
          digest.stats.topJournals.map(function (j) { return j.name + ' (' + j.count + ')'; }).join(', ')));
      }
      container.appendChild(strip);
    }

    ['journals', 'topics', 'preprints'].forEach(function (key) {
      var papers = digest.sections && digest.sections[key];
      if (!papers || !papers.length) { return; }
      var meta = SECTION_META[key];
      var sec = el('section', 'nl-section');
      sec.appendChild(el('h4', 'nl-section-heading', meta.heading));
      var intro = digest.sectionIntros && digest.sectionIntros[key];
      if (intro) { sec.appendChild(el('p', 'nl-section-intro', intro)); }
      papers.forEach(function (p) { sec.appendChild(renderPaperCard(p)); });
      container.appendChild(sec);
    });

    if (!container.querySelector('.nl-section')) {
      container.appendChild(el('p', 'nl-empty', 'No new papers found in this window. Try a longer date range or add more topics/journals.'));
    }

    var foot = el('p', 'nl-footer',
      'Generated by LitDigest from OpenAlex, Crossref' +
      (digest.sections && digest.sections.preprints && digest.sections.preprints.length ? ' and arXiv' : '') +
      ' metadata.');
    container.appendChild(foot);
  }

  /* ---------------- email-ready HTML (pure, node-testable) ---------------- */

  function emailPaperCard(p) {
    var link = paperLink(p);
    var rows = '';
    if (p.journal) {
      rows += '<div style="font-family:' + C.sans + ';font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:' + C.accentDark + ';margin:0 0 4px;">' +
        escapeHtml(p.journal) +
        (p.date ? ' <span style="color:' + C.inkSoft + ';text-transform:none;letter-spacing:0;">&nbsp;·&nbsp;' + escapeHtml(formatDate(p.date)) + '</span>' : '') +
        '</div>';
    }
    rows += '<div style="font-family:' + C.serif + ';font-size:18px;line-height:1.35;font-weight:bold;color:' + C.ink + ';margin:0 0 4px;">' +
      (link ? '<a href="' + escapeHtml(link) + '" style="color:' + C.ink + ';text-decoration:none;">' + escapeHtml(p.title) + '</a>' : escapeHtml(p.title)) +
      '</div>';
    var authors = formatAuthors(p.authors);
    if (authors) {
      rows += '<div style="font-family:' + C.sans + ';font-size:13px;color:' + C.inkSoft + ';font-style:italic;margin:0 0 8px;">' + escapeHtml(authors) + '</div>';
    }
    var takeaway = p.takeaway || p.abstract;
    if (takeaway) {
      rows += '<div style="font-family:' + C.sans + ';font-size:14px;line-height:1.55;color:' + C.ink + ';margin:0 0 8px;">' + escapeHtml(takeaway) + '</div>';
    }
    if (link) {
      rows += '<div style="margin:0 0 4px;"><a href="' + escapeHtml(link) + '" style="font-family:' + C.sans + ';font-size:13px;font-weight:bold;color:' + C.accent + ';text-decoration:none;">Read paper &#8594;</a></div>';
    }
    return '<td style="padding:16px 20px;border:1px solid ' + C.line + ';border-left:4px solid ' + C.accent + ';background-color:' + C.raised + ';">' + rows + '</td>';
  }

  function emailSection(digest, key) {
    var papers = digest.sections && digest.sections[key];
    if (!papers || !papers.length) { return ''; }
    var meta = SECTION_META[key];
    var intro = digest.sectionIntros && digest.sectionIntros[key];
    var html = '<tr><td style="padding:28px 32px 8px;">' +
      '<h2 style="font-family:' + C.serif + ';font-size:21px;color:' + C.accentDark + ';margin:0;padding:0 0 8px;border-bottom:2px solid ' + C.accent + ';">' + escapeHtml(meta.heading) + '</h2>' +
      '</td></tr>';
    if (intro) {
      html += '<tr><td style="padding:8px 32px 0;font-family:' + C.sans + ';font-size:14px;font-style:italic;color:' + C.inkSoft + ';">' + escapeHtml(intro) + '</td></tr>';
    }
    papers.forEach(function (p) {
      html += '<tr><td style="padding:12px 32px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
        emailPaperCard(p) + '</tr></table></td></tr>';
    });
    return html;
  }

  /* Single-file, inline-styled, email-client-friendly newsletter HTML.
   * The only external URLs in the output are links to the papers themselves. */
  function buildEmailHTML(digest) {
    var title = digest.title || 'Research Digest';
    var dateLine = formatDate(digest.generatedAt ? digest.generatedAt.slice(0, 10) : '') +
      (digest.stats ? ' — covering ' + formatDate(digest.stats.from) + ' to ' + formatDate(digest.stats.to) : '');
    var statsHtml = '';
    if (digest.stats) {
      statsHtml = '<tr><td style="padding:0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ' + C.line + ';border-bottom:1px solid ' + C.line + ';"><tr>' +
        '<td style="padding:10px 0;font-family:' + C.sans + ';font-size:13px;color:' + C.inkSoft + ';">' +
        '<strong style="color:' + C.ink + ';">' + digest.stats.totalPapers + '</strong> new papers &nbsp;&#183;&nbsp; ' +
        '<strong style="color:' + C.ink + ';">' + digest.stats.journalCount + '</strong> journals' +
        (digest.stats.topJournals && digest.stats.topJournals.length
          ? ' &nbsp;&#183;&nbsp; Most active: ' + escapeHtml(digest.stats.topJournals.map(function (j) { return j.name; }).join(', '))
          : '') +
        '</td></tr></table></td></tr>';
    }
    var sections = emailSection(digest, 'journals') + emailSection(digest, 'topics') + emailSection(digest, 'preprints');
    if (!sections) {
      sections = '<tr><td style="padding:28px 32px;font-family:' + C.sans + ';font-size:14px;color:' + C.inkSoft + ';">No new papers found in this window.</td></tr>';
    }
    return '<!DOCTYPE html>\n<html lang="en" xmlns="http://www.w3.org/1999/xhtml">\n<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<meta http-equiv="X-UA-Compatible" content="IE=edge">\n' +
      '<title>' + escapeHtml(title) + '</title>\n</head>\n' +
      '<body style="margin:0;padding:0;background-color:' + C.paper + ';">\n' +
      '<div style="background-color:' + C.paper + ';padding:24px 8px;">\n' +
      '<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;margin:0 auto;background-color:' + C.raised + ';border:1px solid ' + C.line + ';">\n' +
      '<tr><td style="padding:32px 32px 20px;border-bottom:3px solid ' + C.accent + ';">' +
      '<div style="font-family:' + C.serif + ';font-size:30px;line-height:1.2;font-weight:bold;color:' + C.ink + ';">' + escapeHtml(title) + '</div>' +
      '<div style="font-family:' + C.sans + ';font-size:13px;color:' + C.inkSoft + ';margin-top:6px;">' + escapeHtml(dateLine) + '</div>' +
      '</td></tr>\n' +
      statsHtml + '\n' + sections + '\n' +
      '<tr><td style="padding:24px 32px 32px;font-family:' + C.sans + ';font-size:12px;color:' + C.inkSoft + ';border-top:1px solid ' + C.line + ';">' +
      'Compiled with LitDigest from OpenAlex, Crossref and arXiv metadata. You are receiving this because you generated it yourself — LitDigest has no server and sends nothing automatically.' +
      '</td></tr>\n' +
      '</table>\n</div>\n</body>\n</html>';
  }

  /* ---------------- plain-text export (pure, node-testable) ---------------- */

  function buildPlainText(digest) {
    var lines = [];
    var title = digest.title || 'Research Digest';
    lines.push(title.toUpperCase());
    lines.push('='.repeat(Math.min(60, title.length + 4)));
    lines.push(formatDate(digest.generatedAt ? digest.generatedAt.slice(0, 10) : '') +
      (digest.stats ? ' — covering ' + digest.stats.from + ' to ' + digest.stats.to : ''));
    if (digest.stats) {
      lines.push('');
      lines.push(digest.stats.totalPapers + ' new papers across ' + digest.stats.journalCount + ' journals' +
        (digest.stats.topJournals && digest.stats.topJournals.length
          ? ' | Most active: ' + digest.stats.topJournals.map(function (j) { return j.name + ' (' + j.count + ')'; }).join(', ')
          : ''));
    }
    ['journals', 'topics', 'preprints'].forEach(function (key) {
      var papers = digest.sections && digest.sections[key];
      if (!papers || !papers.length) { return; }
      lines.push('');
      lines.push(SECTION_META[key].heading.toUpperCase());
      lines.push('-'.repeat(40));
      var intro = digest.sectionIntros && digest.sectionIntros[key];
      if (intro) { lines.push(intro); lines.push(''); }
      papers.forEach(function (p, i) {
        lines.push((i + 1) + '. ' + p.title);
        var meta = [p.journal, formatDate(p.date)].filter(Boolean).join(' — ');
        if (meta) { lines.push('   ' + meta); }
        var authors = formatAuthors(p.authors);
        if (authors) { lines.push('   ' + authors); }
        var takeaway = p.takeaway || p.abstract;
        if (takeaway) { lines.push('   ' + takeaway); }
        var link = paperLink(p);
        if (link) { lines.push('   Read: ' + link); }
        lines.push('');
      });
    });
    lines.push('— Compiled with LitDigest (OpenAlex / Crossref / arXiv metadata).');
    return lines.join('\n');
  }

  global.LitDigestNewsletter = {
    SECTION_META: SECTION_META,
    PALETTE: C,
    escapeHtml: escapeHtml,
    formatAuthors: formatAuthors,
    formatDate: formatDate,
    paperLink: paperLink,
    renderDigest: renderDigest,
    buildEmailHTML: buildEmailHTML,
    buildPlainText: buildPlainText
  };
})(typeof window !== 'undefined' ? window : globalThis);
