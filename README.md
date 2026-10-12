# LitDigest

Literature tracker & newsletter generator for researchers. A fully static web
app — no backend, no build step, no account. Open `index.html`, tell it which
journals and topics you follow, and click **Generate digest** whenever you want
a visually rich, email-ready newsletter of what's new.

## Features

### 1. Tracking setup (Sources & Topics tab)

- **Research topics** — keywords or phrases (comma- or line-separated). These
  drive the "Trending on your topics" section (OpenAlex relevance search with a
  Crossref supplement) and the relevance scoring of every paper.
- **Tracked journals** — paste a **journal name, ISSN, or URL** (journal
  homepage, Scopus/SJR page, `portal.issn.org` link, publisher page). LitDigest
  resolves it to an exact journal record via the
  [OpenAlex sources API](https://docs.openalex.org/api-entities/sources) and
  shows you the match (title, ISSNs, publisher, indexed-work count) to confirm
  before tracking.
- **Curated starter list** — 20 major journals grouped by field
  (business/management heavy by default: AMJ, AMR, ASQ, OrgSci, MgmtSci, SMJ,
  JBV, ETP, JAP, JoM, JIBS, JM, JMR, JCR, MISQ, ISR, AccRev, JF, JFE, RAND),
  one click to add. Titles, ISSNs, and publishers were verified against live
  registry data (October 2026).
- **Optional arXiv feeds** — pick categories (e.g. `econ.GN`, `cs.CL`) or add
  your own; new preprints land in a "Preprints" section.
- **Date range** — last 7 / 14 / 30 / 90 days.

One honest note, shown in the app: **ResearchGate and most publisher websites
block programmatic access**, so LitDigest does not scrape them — it tracks the
same journals' papers through the open OpenAlex, Crossref, and arXiv indexes.

### 2. Digest engine (`js/fetch.js`)

- **OpenAlex primary**: keyword search for topics (relevance-ranked),
  `primary_location.source.issn` + `from_publication_date` filters for tracked
  journals (newest first).
- **Crossref supplement/fallback**: `query.bibliographic` per topic, and a
  per-journal fallback if OpenAlex is unavailable.
- **arXiv API** for selected categories. arXiv sends no CORS headers, so the
  app tries a direct fetch first and then public CORS relays; if all fail, the
  preprint section is skipped and the digest says so.
- **Dedupe** by DOI, then by normalized title (a DOI-less Crossref hit merges
  into the OpenAlex record); tags from all sources are unioned.
- **Relevance scoring** vs your topics: phrase hits in title/abstract, token
  overlap, small citation bonus; a score floor keeps off-topic supplement hits
  out of the trending section.
- **Concurrency-limited** fetching (3 requests in flight) with a live progress
  bar and per-source graceful errors — one failing source never sinks the
  digest.
- **Optional AI takeaways** (BYO key, any OpenAI-compatible endpoint): a 2–3
  sentence plain-language takeaway per paper plus a one-line intro per section.
  The key lives only in this browser's localStorage and is sent only to the
  endpoint you configure. Without a key, digests use abstract excerpts —
  everything still works.

### 3. Newsletter (Digest tab)

- **On-demand generation** — click Generate whenever you like. There is no
  server, so there is **no automatic daily schedule**; bookmark the page and
  run it each morning or week. The UI says this plainly.
- **Editorial layout**, distinct from the utilitarian app UI: masthead with
  your newsletter title (editable in Settings), date line, a stats strip (N new
  papers across M journals, most-active journals), and grouped sections —
  *In your tracked journals*, *Trending on your topics*, *Preprints* — with
  per-paper cards (journal, title, authors, takeaway, "Read paper" link,
  open-access link where available).
- **Exports**:
  1. **Email-ready HTML** — single-file, inline-styled, table-based 640 px
     layout; the only external URLs are links to the papers. Download it, then
     paste it straight into Gmail (open the file, select-all, copy, paste into
     compose) or import into Substack — in-app instructions included.
  2. **PDF** — a dedicated print stylesheet hides all app chrome and prints
     just the newsletter; the button runs `window.print()`.
  3. **Copy-all text** — a clean plain-text version of the whole digest.
- **Digest history** — the last 12 digests are stored in localStorage; reload
  any of them to re-view or re-export.

### 4. Settings

Newsletter title, AI endpoint/model/key, and config export/import as `.json`
(AI keys are never exported). All state lives in localStorage.

## Screenshots

<!-- Add screenshots after deploying, e.g.:
![Digest with rendered newsletter](docs/screenshot-digest.png)
![Sources & Topics setup](docs/screenshot-sources.png)
![Email-ready HTML export](docs/screenshot-email.png)
-->

_coming soon_

## Tech

- Vanilla HTML/CSS/JS. No framework, no bundler, no build step — and **no CDN
  dependencies at all**: every line of JavaScript is in this repo.
- APIs (free, no key):
  [OpenAlex](https://docs.openalex.org/),
  [Crossref REST API](https://api.crossref.org/), and the
  [arXiv API](https://info.arxiv.org/help/api/) (via a CORS relay when needed).
- `mailto` placeholders for the OpenAlex/Crossref polite pools live in
  `js/sources.js` / `js/fetch.js` — replace with your own email for production
  use.

## Run locally

Option A — just open the file:

```
open index.html        # macOS
start index.html       # Windows
xdg-open index.html    # Linux
```

Option B — serve it (recommended, behaves exactly like hosting):

```
cd litdigest
python3 -m http.server 8000
# then visit http://localhost:8000
```

Any static server works (`npx serve`, nginx, …). Internet access is required
for the metadata APIs and (optionally) your AI endpoint.

## Tests

```
node tests/smoke.js    # URL builders, dedupe/relevance fixtures, email-HTML
                       # self-containment, live Crossref/arXiv/OpenAlex queries
node tests/e2e.js      # Playwright + system Chromium: full generate/export/
                       # print flow, zero unexpected console errors
```

Both are dependency-free except `e2e.js`, which needs `playwright` installed
and a Chromium binary (set `CHROMIUM_PATH` if not at `/usr/bin/chromium`).

## Put it on GitHub (step-by-step, no git experience needed)

1. Create a free account at <https://github.com> and sign in.
2. Click the **+** in the top-right corner → **New repository**.
3. Name it `litdigest`, leave it **Public**, do **not** check "Add a README"
   (this repo already has one), click **Create repository**.
4. Install git if you don't have it: <https://git-scm.com/downloads>
   (accept the defaults during install).
5. Open a terminal (macOS/Linux) or **Git Bash** (Windows) and run:

   ```
   cd path/to/litdigest          # the folder containing index.html
   git init                      # only if this isn't already a git repo
   git add .
   git commit -m "Initial commit: LitDigest"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/litdigest.git
   git push -u origin main
   ```

   Replace `YOUR-USERNAME` with your GitHub username. When asked to sign in,
   use the browser window that opens (or a personal access token).
6. Refresh your repository page on GitHub — you should see all the files.

## Deploy to GitHub Pages

1. In your GitHub repository, click **Settings** → **Pages** (left sidebar).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Under **Branch**, select **main** and **/ (root)**, click **Save**.
4. Wait a minute, then reload the page — GitHub shows your site URL:
   `https://YOUR-USERNAME.github.io/litdigest/`

That's it — the app is a plain static site, so no build configuration is
needed.

## Embed in your personal website

```html
<iframe
  src="https://YOUR-USERNAME.github.io/litdigest/"
  style="width:100%; max-width:1020px; height:800px; border:1px solid #e2d9c9; border-radius:4px;"
  title="LitDigest — literature tracker and newsletter generator"
  loading="lazy">
</iframe>
```

Deep-link to a specific tab with the URL hash: `#digest`, `#sources`, or
`#settings`:

```html
<iframe src="https://YOUR-USERNAME.github.io/litdigest/#sources" …></iframe>
```

## Repository layout

```
litdigest/
├── index.html
├── styles.css
├── app.js               # UI wiring: tabs, tracking setup, generate, exports, history, settings
├── js/
│   ├── sources.js       # journal resolution via the OpenAlex sources API
│   ├── fetch.js         # digest engine: OpenAlex/Crossref/arXiv, dedupe, relevance, pooling
│   ├── ai.js            # optional BYO-key AI takeaways (OpenAI-compatible, localStorage only)
│   ├── newsletter.js    # editorial rendering, email-HTML + plain-text builders
│   └── data/
│       └── journals.js  # verified starter journal list + arXiv category groups
├── tests/
│   ├── smoke.js         # node smoke tests (builders, fixtures, live queries)
│   └── e2e.js           # Playwright e2e (dev harness)
├── README.md
├── LICENSE              # MIT
└── .gitignore
```

## Disclaimer

Coverage depends on index lag — very fresh papers can take days to appear in
OpenAlex/Crossref, and arXiv availability depends on public CORS relays. Always
follow the DOI link for the authoritative record, and double-check journal
metadata against the publisher page.

## License

MIT — see [LICENSE](LICENSE).
