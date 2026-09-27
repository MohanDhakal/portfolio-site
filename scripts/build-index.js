#!/usr/bin/env node
/**
 * Scans /articles and /highlights and writes /data/articles.json.
 *
 * This is the whole "backend" of the site: run it after adding,
 * editing, or removing a Markdown file, and the homepage, articles
 * page, categories, and search all update to match. The GitHub
 * Actions workflow in .github/workflows/deploy.yml runs it
 * automatically on every push, so in normal use you never have to
 * run this by hand — it's here mainly so you can preview the site
 * locally (see README.md).
 *
 * No npm dependencies required — frontmatter parsing below only
 * handles the small subset of YAML this project's articles actually
 * use (string fields + a simple list for tags), which is enough for
 * a personal site and keeps the build dependency-free.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ARTICLES_DIR = path.join(ROOT, "articles");
const HIGHLIGHTS_DIR = path.join(ROOT, "highlights");

const OUT_FILE = path.join(ROOT, "data", "articles.json");

function walkMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

// Minimal frontmatter parser: handles
//   title: "..."          -> string (quotes optional)
//   tags:
//     - a
//     - b                  -> array
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, content: raw };

  const data = {};
  const lines = match[1].split(/\r?\n/);
  let currentListKey = null;

  for (const line of lines) {
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && currentListKey) {
      data[currentListKey].push(stripQuotes(listItem[1].trim()));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      const value = kv[2].trim();
      if (value === "") {
        data[key] = [];
        currentListKey = key;
      } else {
        data[key] = stripQuotes(value);
        currentListKey = null;
      }
    }
  }
  return { data, content: raw.slice(match[0].length) };
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function titleCaseFromFilename(filename) {
  return filename
    .replace(/\.md$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

function excerptFrom(markdownBody) {
  const withoutHeadings = markdownBody
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  const firstParagraph = withoutHeadings
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .find((p) => p.length > 0);
  if (!firstParagraph) return "";
  const plain = firstParagraph
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 200 ? plain.slice(0, 197).trim() + "..." : plain;
}

function readingTimeFor(markdownBody) {
  const words = markdownBody.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildArticles() {
  const files = walkMarkdownFiles(ARTICLES_DIR);
  return files.map((filePath) => {
    const raw = fs.readFileSync(filePath, "utf8");
    const { data, content } = parseFrontmatter(raw);

    const relFromArticles = path.relative(ARTICLES_DIR, filePath);
    const category = path.dirname(relFromArticles).split(path.sep)[0];
    const filename = path.basename(filePath);

    const title = data.title || titleCaseFromFilename(filename);
    const description = data.description || "";
    const tags = Array.isArray(data.tags) ? data.tags : [];
    let date = data.date || null;
    if (!date) {
      const stat = fs.statSync(filePath);
      date = stat.mtime.toISOString().slice(0, 10);
    }

    const relFromRoot = path.relative(ROOT, filePath).split(path.sep).join("/");

    return {
      title,
      description,
      excerpt: description || excerptFrom(content),
      category,
      tags,
      date,
      readingTime: readingTimeFor(content),
      path: relFromRoot, // e.g. "articles/PostgreSQL/Understanding PITR.md"
      slug: slugify(category) + "/" + slugify(title),
      filename,
    };
  });
}

function buildHighlights(articles) {
  if (!fs.existsSync(HIGHLIGHTS_DIR)) return [];
  const highlightFiles = fs
    .readdirSync(HIGHLIGHTS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".md"));

  const byFilename = new Map(articles.map((a) => [a.filename.toLowerCase(), a]));

  return highlightFiles
    .map((f) => byFilename.get(f.toLowerCase()))
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function buildCategories(articles) {
  const counts = new Map();
  for (const a of articles) counts.set(a.category, (counts.get(a.category) || 0) + 1);
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  const articles = buildArticles();
  const highlights = buildHighlights(articles);
  const categories = buildCategories(articles);

  const index = {
    generatedAt: new Date().toISOString(),
    articles,
    highlights,
    categories,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(index, null, 2));
  console.log(
    `Wrote ${OUT_FILE}: ${articles.length} article(s), ${categories.length} categor${categories.length === 1 ? "y" : "ies"}, ${highlights.length} highlight(s).`
  );
}

main();
