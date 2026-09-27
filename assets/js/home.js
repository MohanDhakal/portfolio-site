document.addEventListener("DOMContentLoaded", () => {
  const highlightsGrid = document.getElementById("highlights-grid");
  const tagCloud = document.getElementById("exploring-tags");
  const statArticles = document.getElementById("stat-articles");
  const statCategories = document.getElementById("stat-categories");

  loadIndex().then((data) => {
    const highlights = data.highlights || [];

    if (highlightsGrid) {
      highlightsGrid.innerHTML = "";
      if (highlights.length === 0) {
        highlightsGrid.innerHTML = `<div class="empty-state">No highlighted articles yet.<br>Add a file to /highlights to feature one here.</div>`;
      } else {
        highlights.slice(0, 6).forEach((a) => highlightsGrid.appendChild(renderCard(a)));
      }
    }

    if (statArticles) statArticles.textContent = (data.articles || []).length;
    if (statCategories) statCategories.textContent = (data.categories || []).length;

    if (tagCloud) {
      tagCloud.innerHTML = "";
      (data.categories || []).forEach((c) => {
        const a = document.createElement("a");
        a.className = "tag-pill";
        a.href = categoryUrl(c.name);
        a.textContent = c.name;
        tagCloud.appendChild(a);
      });
    }
  });
});
