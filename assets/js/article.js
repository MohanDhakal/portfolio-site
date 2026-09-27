function stripFrontmatter(raw) {
    const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return m ? raw.slice(m[0].length) : raw;
}

function renderRelated(container, current, allArticles) {
    const sameCategory = allArticles.filter(
        (a) => a.category === current.category && a.path !== current.path
    );
    let pool = sameCategory;
    if (pool.length < 3) {
        const others = allArticles.filter(
            (a) => a.category !== current.category && a.path !== current.path
        );
        pool = pool.concat(others);
    }
    const picks = pool.slice(0, 4);

    container.innerHTML = "";
    if (picks.length === 0) {
        container.innerHTML = `<p class="loading-hint">Nothing else here yet.</p>`;
        return;
    }
    picks.forEach((a) => {
        const el = document.createElement("a");
        el.className = "related-item";
        el.href = articleUrl(a);
        el.innerHTML = `<div class="ri-title">${escapeHtml(a.title)}</div><div class="ri-meta">${escapeHtml(a.category)} &middot; ${a.readingTime} min</div>`;
        container.appendChild(el);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    const path = params.get("path");
    const root = document.getElementById("article-root");
    const progressBar = document.getElementById("progress-bar");

    if (!path) {
        root.innerHTML = `<div class="empty-state">No article specified.</div>`;
        return;
    }

    loadIndex().then((data) => {
        const meta = (data.articles || []).find((a) => a.path === path);
        if (!meta) {
            root.innerHTML = `<div class="empty-state">Article not found. It may have been renamed or removed.</div>`;
            return;
        }

        document.title = meta.title + " — Data Garden";

        fetch(siteUrl(meta.path))
            .then((r) => {
                if (!r.ok) throw new Error("Could not load article file (" + r.status + ")");
                return r.text();
            })
            .then((raw) => {
                const body = stripFrontmatter(raw);
                const html = marked.parse(body, { breaks: false, gfm: true });

                const dateStr = formatDate(meta.date);
                const metaBits = [`${meta.readingTime} min read`];
                if (dateStr) metaBits.unshift(dateStr);
                const tone = toneForCategory(meta.category);

                root.innerHTML = `
          <nav class="breadcrumb">
            <a href="${siteUrl("index.html")}">Home</a> /
            <a href="${siteUrl("articles.html")}">Articles</a> /
            <a href="${categoryUrl(meta.category)}">${escapeHtml(meta.category)}</a>
          </nav>
          <div class="article-layout">
            <div>
              <header class="article-header">
                <a class="badge tone-${tone}" href="${categoryUrl(meta.category)}">${escapeHtml(meta.category)}</a>
                <h1>${escapeHtml(meta.title)}</h1>
                ${meta.description ? `<p class="subtitle">${escapeHtml(meta.description)}</p>` : ""}
                <div class="card-meta">${metaBits.map((b, i) => (i > 0 ? `<span class="dot"></span>${b}` : b)).join("")}</div>
              </header>
              <div class="article-body">${html}</div>
            </div>
            <aside class="article-sidebar">
              <div class="sidebar-title">Related articles</div>
              <div class="related-list" id="related-list"></div>
            </aside>
          </div>
        `;

                if (window.hljs) {
                    root.querySelectorAll("pre code").forEach((block) => hljs.highlightElement(block));
                }

                renderRelated(document.getElementById("related-list"), meta, data.articles || []);

                // Reading progress bar.
                function updateProgress() {
                    const doc = document.documentElement;
                    const scrollTop = doc.scrollTop || document.body.scrollTop;
                    const height = doc.scrollHeight - doc.clientHeight;
                    const pct = height > 0 ? Math.min(100, (scrollTop / height) * 100) : 0;
                    if (progressBar) progressBar.style.width = pct + "%";
                }
                document.addEventListener("scroll", updateProgress, { passive: true });
                updateProgress();
            })
            .catch((err) => {
                console.error(err);
                root.innerHTML = `<div class="empty-state">Couldn't load this article's content.</div>`;
            });
    });
});
