import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, sep } from "node:path";

import { readFrontmatter } from "./frontmatter.js";

const PAGE_RE = /(^|[\\/])page\.(mdx|md|[jt]sx)$/;
const MD_RE = /\.(mdx|md)$/;

function abs(baseUrl, path) {
  return baseUrl.replace(/\/+$/, "") + (path === "/" ? "/" : path);
}

function routePath(appDir, file) {
  const rel = relative(appDir, file).split(sep).join("/");
  if (!PAGE_RE.test(rel)) return null;
  const dir = dirname(rel).split(sep).join("/");
  if (dir === ".") return "/";
  const segments = dir.split("/");
  if (segments.some((seg) => seg.startsWith("_") || seg.startsWith(".") || seg.includes("["))) {
    return null;
  }
  return "/" + segments.join("/");
}

function humanize(seg) {
  return seg.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function titleFor(file, path) {
  const fm = MD_RE.test(file) ? readFrontmatter(file) : {};
  if (fm.title) return String(fm.title);
  if (path === "/") return "Home";
  return humanize(path.split("/").filter(Boolean).at(-1) ?? "Home");
}

function descriptionFor(file) {
  const fm = MD_RE.test(file) ? readFrontmatter(file) : {};
  return fm.description ? String(fm.description) : "";
}

function stripFrontmatter(source) {
  return source.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function stripMdxBoilerplate(source) {
  const lines = stripFrontmatter(source).split(/\r?\n/);
  const out = [];
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) inFence = !inFence;
    if (!inFence && /^\s*import\s/.test(line)) continue;
    if (!inFence && /^\s*export\s+(const|let|var|default)\s/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

function sectionFor(path) {
  if (path === "/") return "Start Here";
  if (path.startsWith("/docs")) return "Documentation";
  if (path.startsWith("/api")) return "API Reference";
  if (path.startsWith("/blog")) return "Blog";
  return "Other Routes";
}

function pageRecords({ appDir, pages = [], baseUrl }) {
  return pages
    .filter((file) => PAGE_RE.test(file))
    .map((file) => {
      const path = routePath(appDir, file);
      if (!path) return null;
      return {
        file,
        path,
        url: abs(baseUrl, path),
        title: titleFor(file, path),
        description: descriptionFor(file),
        markdown: MD_RE.test(file) && existsSync(file) ? stripMdxBoilerplate(readFileSync(file, "utf8")) : "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.path === "/") return -1;
      if (b.path === "/") return 1;
      return a.path.localeCompare(b.path);
    });
}

function grouped(records) {
  const out = new Map();
  for (const record of records) {
    const section = sectionFor(record.path);
    if (!out.has(section)) out.set(section, []);
    out.get(section).push(record);
  }
  return out;
}

const SECTION_ORDER = ["Start Here", "Documentation", "API Reference", "Blog", "Other Routes"];

export function renderLlmsTxt({ appDir, pages = [], baseUrl, config = {} } = {}) {
  const title = config?.docs?.title || "OTF Web";
  const records = pageRecords({ appDir, pages, baseUrl });
  const description =
    config?.docs?.description ||
    "Documentation, API reference, and blog content for the OTF Web framework.";
  const lines = [
    `# ${title}`,
    "",
    `> ${description}`,
    "",
    `This file is a curated entry point for language models. For full page content, see [llms-full.txt](${abs(baseUrl, "/llms-full.txt")}).`,
    "",
  ];

  const groups = grouped(records);
  for (const section of SECTION_ORDER) {
    const items = groups.get(section);
    if (!items?.length) continue;
    lines.push(`## ${section}`, "");
    for (const item of items) {
      const note = item.description ? `: ${item.description}` : "";
      lines.push(`- [${item.title}](${item.url})${note}`);
    }
    lines.push("");
  }

  if (config?.blog) {
    lines.push("## Optional", "");
    lines.push(`- [RSS feed](${abs(baseUrl, `/${config.blog.dir ?? "blog"}/rss.xml`)}): Blog feed in RSS 2.0 format.`);
    lines.push(`- [Atom feed](${abs(baseUrl, `/${config.blog.dir ?? "blog"}/atom.xml`)}): Blog feed in Atom 1.0 format.`);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function renderLlmsFullTxt({ appDir, pages = [], baseUrl, config = {} } = {}) {
  const title = config?.docs?.title || "OTF Web";
  const records = pageRecords({ appDir, pages, baseUrl }).filter((record) => record.markdown);
  const lines = [
    `# ${title} Full Documentation`,
    "",
    `Generated from filesystem routes for ${baseUrl.replace(/\/+$/, "")}.`,
    "",
  ];

  for (const record of records) {
    lines.push(`## ${record.title}`, "");
    lines.push(`URL: ${record.url}`);
    if (record.description) lines.push(`Description: ${record.description}`);
    lines.push("");
    lines.push(record.markdown);
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
