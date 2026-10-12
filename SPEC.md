# SPEC — LitDigest (App 4)

Literature tracker + visually rich newsletter generator for researchers. Static web app, zero backend, no build step. Same suite visual language (warm neutrals, serif headings, no gradients, no emojis).

## Deliverable
Repo folder: `/mnt/agents/output/academic-apps/litdigest/` — index.html, styles.css, app.js, js/ modules, README.md, LICENSE (MIT), .gitignore. git init + commit.

## Features

### 1. Tracking setup (js/sources.js, js/data/journals.js)
- **Research topics**: user enters keywords/phrases (multiple, comma or line separated) — mapped to OpenAlex concepts/keywords
- **Tracked journals**: user adds journals they want to follow for sure — paste journal name, ISSN, or a URL (journal homepage / Scopus/SJR / publisher page); app resolves to ISSN via OpenAlex sources API (`https://api.openalex.org/sources?search=...` / issn lookup) so the user can confirm the exact journal matched
- Curated starter list of major journals by field (business/management default: AMJ, AMR, ASQ, OrgSci, MgmtSci, SMJ, JBV, ETP, JAP, JoM, JIBS, JM, JMR, JCR, MISQ, ISR, AccRev, JF, JFE, RAND etc.) — one-click add
- Honest UI note: ResearchGate/publisher sites block programmatic access; tracking runs via OpenAlex/Crossref/arXiv which index those journals' papers
- Optional extra feeds: arXiv categories (e.g., econ.GN, cs.CL) for preprints
- Date range: last 7 / 14 / 30 / 90 days

### 2. Digest engine (js/fetch.js)
- Fetch recent works from **OpenAlex** (primary: filters by concept/keyword search + host_venue ISSN + from_publication_date; sort by date, cited_by for ranking) with **Crossref** fallback/supplement (query.bibliographic + filter=from-pub-date) and **arXiv API** if categories selected
- Dedupe by DOI/title; relevance scoring vs user topics (token overlap + abstract match); per-paper: title, authors, journal, date, DOI link, abstract snippet, open-access link where available
- Concurrency-limited, progress indication, graceful API errors
- Optional AI summaries (BYO key, OpenAI-compatible, localStorage only): 2-3 sentence plain-language takeaway per paper + section intro; without key, use abstract snippet as-is

### 3. Newsletter (js/newsletter.js)
- **In-app generation on demand** — user clicks Generate whenever they want (UI hint: bookmark and run daily/weekly; no server = no automatic scheduling; honest about this)
- Visually rich newsletter layout, distinct from the utilitarian app UI: masthead with newsletter name (user-editable, e.g., "Strategy Research Weekly"), date, editorial-style typography, grouped sections ("In your tracked journals", "Trending on your topics", "Preprints"), per-paper cards with journal name, title, authors, takeaway, "Read paper" link
- Stats strip: N new papers across M journals, top journals this period
- **Exports**: (a) **email-ready HTML** file download — inline-styled, single-file, paste-into-Gmail/Substack friendly, with instructions; (b) **PDF** via a dedicated print stylesheet + window.print() flow (print view = clean newsletter, no app chrome); (c) copy-all text
- Digest history: last N digests stored in localStorage with date; reload any past digest

### 4. Settings
- Newsletter title/branding, topics, journals, arXiv categories, AI key — all localStorage; export/import config .json

## Quality bar
- node --check all JS; curl-verify CDNs; node smoke tests: OpenAlex query builders produce valid URLs (verify one live query returns works), dedupe/relevance functions, HTML email template generation (inline styles present, no external deps); browser e2e if harness available (add topic + journal, generate digest with live OpenAlex data, export HTML, open print view) with zero console errors
- README: sibling structure (features, local run, GitHub push, Pages, embed)
