<!-- # Knowledge Garden

A minimal, content-first personal site for GitHub Pages. It's built from plain
HTML/CSS/JS — no framework, no backend, no database. The Git repository *is*
the content management system: articles are Markdown files, and the site
discovers them automatically.

## How it works

- Every article lives at `articles/<Category>/<Title>.md`. The folder name
  becomes the category; the file becomes an article.
- `highlights/<Title>.md` is a *pointer*, not a category. If a filename in
  `highlights/` matches a filename somewhere under `articles/`, that article
  is featured on the homepage. The content of the pointer file itself is
  ignored — only the filename is used to match it up.
- `scripts/build-index.js` scans both folders and writes `data/articles.json`,
  which every page fetches at load time to render cards, categories, and
  search. This is the only "build step" in the whole project, and it runs
  automatically on every push via `.github/workflows/deploy.yml`.

Nothing in `assets/js/*.js` or the HTML pages hardcodes an article list —
add or remove a file, and the site reflects it after the index is rebuilt.

## Adding an article

1. Create a Markdown file under `articles/<Category>/`, e.g.:
   ```
   articles/Python/Python Generators.md
   ```
   If `Python/` doesn't exist yet, creating it *is* creating the category —
   nothing else needs to be registered anywhere.

2. Optionally add frontmatter at the top of the file:
   ```markdown
   ---
   title: "Python Generators, Properly Explained"
   description: "One sentence that becomes the card excerpt and page subtitle."
   date: "2026-10-02"
   tags:
     - Python
     - Generators
   ---

   Article content starts here...
   ```
   If you skip frontmatter entirely, the site falls back to sensible
   defaults: the filename becomes the title, the parent folder becomes the
   category, the file's last-modified date becomes the date, and the first
   paragraph becomes the excerpt.

3. Commit and push. The GitHub Actions workflow rebuilds `data/articles.json`
   and redeploys automatically — you don't need to run anything locally.

## Creating a new category

Just create the folder. `articles/Kubernetes/` with one file in it is a new
"Kubernetes" category, filterable on the Articles page and listed under
"Currently exploring" on the homepage, with no other changes required.

## Adding an article to highlights

Add an empty (or commented) file to `highlights/` with **the exact same
filename** as the article you want featured:

```
highlights/Python Generators.md
```

It will appear in the homepage's "From the knowledge garden" section (the
newest 3–6 highlighted articles are shown).

## Removing an article from highlights

Delete the matching file from `highlights/`. The article itself is untouched
and still reachable from the Articles page — it just stops appearing on the
homepage.

## Running the site locally

Because pages `fetch()` `data/articles.json` and the raw `.md` files, opening
`index.html` directly from disk (`file://`) won't work — browsers block
`fetch` against local files. Serve the folder over HTTP instead:

```bash
node scripts/build-index.js   # regenerate data/articles.json after any edit
python3 -m http.server 8000   # or: npx serve .
```

Then open `http://localhost:8000`.

## Deploying to GitHub Pages

1. Push this repository to GitHub.
2. In the repo settings, go to **Pages** and set the source to
   **GitHub Actions** (not "Deploy from a branch").
3. Push to `main`. The included workflow
   (`.github/workflows/deploy.yml`) rebuilds the article index and deploys
   automatically. No further configuration is needed — the site uses
   relative paths throughout, so it works whether it's served from
   `username.github.io` or `username.github.io/repo-name`.

## Project structure

```
index.html            Homepage: intro, timeline, highlights, "exploring" tags
articles.html          All articles, filterable by category
article.html           Single-article reader (?path=articles/...)
about.html             About page
404.html               GitHub Pages fallback for unknown paths

articles/<Category>/   Your articles, as Markdown
highlights/            Pointer files that feature articles on the homepage

data/articles.json     Generated index — do not hand-edit, run the build script instead
scripts/build-index.js  Generates data/articles.json from articles/ and highlights/

assets/css/style.css   All styling
assets/js/utils.js     Shared helpers: data loading, card rendering, search, nav
assets/js/home.js      Homepage-specific rendering
assets/js/articles.js  Articles-page filtering
assets/js/article.js   Article reader: Markdown rendering, related articles, progress bar

.github/workflows/deploy.yml  Rebuilds the index and deploys on every push
```

## Personalizing it

The content in this repo (name, bio, timeline entries, the three PostgreSQL
articles) is starter content — replace it with your own:

- Edit the hero text and timeline in `index.html`.
- Edit `about.html`.
- Replace `assets/images/profile-placeholder.svg` with an actual photo (update
  the `<img>` tags in `index.html` and `about.html` accordingly).
- Replace or remove the three sample articles under `articles/PostgreSQL/`
  and the matching files in `highlights/`.
- Update the `.brand` text and GitHub link in each HTML file's `<nav>` and
  footer.

## Notes on markdown support

Articles are rendered with [marked](https://marked.js.org/) and syntax
highlighting from [highlight.js](https://highlightjs.org/), both loaded from
a CDN at read time — no bundler involved. Headings, code blocks (with
language hints, e.g. ```` ```sql ````), tables, blockquotes, images, and
links all render out of the box. -->
