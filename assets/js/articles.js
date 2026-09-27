document.addEventListener("DOMContentLoaded", () => {
  const grid = document.getElementById("articles-grid");
  const filterRow = document.getElementById("filter-row");
  const countLabel = document.getElementById("articles-count");

  const params = new URLSearchParams(window.location.search);
  let activeCategory = params.get("category") || "All";

  loadIndex().then((data) => {
    const articles = (data.articles || []).slice().sort((a, b) => {
      // Newest first; articles without a date sort after dated ones.
      if (!a.date && !b.date) return a.title.localeCompare(b.title);
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date) - new Date(a.date);
    });
    const categories = ["All", ...(data.categories || []).map((c) => c.name)];

    function renderChips() {
      filterRow.innerHTML = "";
      categories.forEach((cat) => {
        const chip = document.createElement("button");
        chip.className = "filter-chip" + (cat === activeCategory ? " active" : "");
        chip.textContent = cat;
        chip.addEventListener("click", () => {
          activeCategory = cat;
          const url = new URL(window.location.href);
          if (cat === "All") url.searchParams.delete("category");
          else url.searchParams.set("category", cat);
          history.replaceState(null, "", url);
          renderChips();
          renderGrid();
        });
        filterRow.appendChild(chip);
      });
    }

    function renderGrid() {
      const filtered = activeCategory === "All"
        ? articles
        : articles.filter((a) => a.category === activeCategory);

      grid.innerHTML = "";
      if (filtered.length === 0) {
        grid.innerHTML = `<div class="empty-state">No articles in this category yet.</div>`;
      } else {
        filtered.forEach((a) => grid.appendChild(renderCard(a)));
      }
      if (countLabel) {
        countLabel.textContent = `${filtered.length} article${filtered.length === 1 ? "" : "s"}`;
      }
    }

    renderChips();
    renderGrid();
  });
});
