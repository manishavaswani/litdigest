/* LitDigest — js/ai.js
 * Optional AI takeaways (BYO key, OpenAI-compatible chat-completions endpoint).
 * Settings are stored ONLY in this browser's localStorage and the key is sent
 * ONLY to the endpoint the user configures. Without a key the digest falls
 * back to plain abstract snippets — the app is fully functional either way.
 * Exposed as window.LitDigestAI.
 */
(function (global) {
  'use strict';

  var LS_KEY = 'litdigest.ai.v1';

  function getSettings() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      var s = raw ? JSON.parse(raw) : {};
      return { endpoint: s.endpoint || '', model: s.model || '', key: s.key || '' };
    } catch (e) { return { endpoint: '', model: '', key: '' }; }
  }

  function saveSettings(s) {
    localStorage.setItem(LS_KEY, JSON.stringify({
      endpoint: String(s.endpoint || '').trim(),
      model: String(s.model || '').trim(),
      key: String(s.key || '').trim()
    }));
  }

  function isConfigured() {
    var s = getSettings();
    return !!(s.endpoint && s.key);
  }

  function clearSettings() { localStorage.removeItem(LS_KEY); }

  /* One chat-completions call; resolves to the assistant message text. */
  function chat(systemPrompt, userPrompt) {
    var s = getSettings();
    if (!s.endpoint || !s.key) {
      return Promise.reject(new Error('No AI endpoint configured — using abstract snippets instead.'));
    }
    var url = s.endpoint.replace(/\/+$/, '') + '/chat/completions';
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.key },
      body: JSON.stringify({
        model: s.model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3
      })
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error('AI endpoint returned HTTP ' + r.status + (t ? ' — ' + t.slice(0, 200) : ''));
        });
      }
      return r.json();
    }).then(function (j) {
      var msg = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!msg) { throw new Error('AI endpoint returned an unexpected response shape.'); }
      return msg.trim();
    });
  }

  var SYS = 'You are the editor of an academic research newsletter. Write concise, plain-language, truthful takeaways for busy researchers. Never invent findings; use only the title and abstract provided. No hype, no emojis.';

  /* 2-3 sentence plain-language takeaway for one paper. Falls back silently
   * (caller catches and keeps the abstract snippet). */
  function takeaway(paper, topics) {
    return chat(SYS,
      'Write a 2-3 sentence plain-language takeaway explaining what this paper did and why it matters' +
      (topics && topics.length ? ', for a reader tracking: ' + topics.join('; ') : '') +
      '. Return only the takeaway text.\n\nTitle: ' + paper.title +
      '\nVenue: ' + (paper.journal || 'n/a') +
      '\nAbstract: ' + (paper.abstract || '(no abstract available — base the takeaway on the title alone and say so)'));
  }

  /* One-sentence intro line for a newsletter section. */
  function sectionIntro(sectionName, papers, topics) {
    var titles = papers.slice(0, 8).map(function (p) { return '- ' + p.title; }).join('\n');
    return chat(SYS,
      'Write ONE sentence (max 30 words) introducing the "' + sectionName + '" section of a research newsletter' +
      (topics && topics.length ? ' for a reader tracking: ' + topics.join('; ') : '') +
      '. Return only the sentence.\n\nPapers in this section:\n' + titles);
  }

  global.LitDigestAI = {
    getSettings: getSettings,
    saveSettings: saveSettings,
    clearSettings: clearSettings,
    isConfigured: isConfigured,
    chat: chat,
    takeaway: takeaway,
    sectionIntro: sectionIntro
  };
})(typeof window !== 'undefined' ? window : globalThis);
