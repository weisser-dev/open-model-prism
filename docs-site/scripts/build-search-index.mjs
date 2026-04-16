#!/usr/bin/env node
/**
 * Generates public/search-index.json from .astro page sources.
 * Strips HTML tags, extracts headings + surrounding text, builds
 * a flat array of searchable sections.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

const PAGES_DIR = join(import.meta.dirname, '..', 'src', 'pages');
const OUT_FILE  = join(import.meta.dirname, '..', 'public', 'search-index.json');

function collectAstroFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectAstroFiles(full));
    } else if (entry.endsWith('.astro') && entry !== '404.astro') {
      files.push(full);
    }
  }
  return files;
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&rarr;/g, '→')
    .replace(/&#123;/g, '{')
    .replace(/&#125;/g, '}')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fileToPath(file) {
  const rel = relative(PAGES_DIR, file).replace(/\.astro$/, '');
  if (rel === 'index') return '/';
  if (rel.endsWith('/index')) return '/' + rel.slice(0, -6);
  return '/' + rel;
}

function extractTitle(content) {
  const match = content.match(/title="([^"]+)"/);
  return match ? match[1].replace(/ — .*$/, '') : '';
}

function extractSections(content, pagePath, pageTitle) {
  // Remove frontmatter
  const body = content.replace(/^---[\s\S]*?---/, '');

  const sections = [];
  // Split on h1, h2, h3 tags
  const headingRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let lastIndex = 0;
  let lastHeading = pageTitle;
  let lastAnchor = '';

  const matches = [...body.matchAll(headingRe)];

  if (matches.length === 0) {
    // No headings, index entire page as one section
    const text = stripTags(body);
    if (text.length > 20) {
      sections.push({ title: pageTitle, href: pagePath, text: text.slice(0, 500) });
    }
    return sections;
  }

  for (const m of matches) {
    // Capture text between previous heading and this one
    const textBetween = stripTags(body.slice(lastIndex, m.index));
    if (textBetween.length > 20) {
      sections.push({
        title: lastHeading,
        href: lastAnchor ? `${pagePath}#${lastAnchor}` : pagePath,
        text: textBetween.slice(0, 500),
      });
    }

    lastIndex = m.index + m[0].length;
    lastHeading = stripTags(m[2]);
    // Generate anchor from heading text
    lastAnchor = lastHeading
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  // Capture remaining text after last heading
  const remaining = stripTags(body.slice(lastIndex));
  if (remaining.length > 20) {
    sections.push({
      title: lastHeading,
      href: lastAnchor ? `${pagePath}#${lastAnchor}` : pagePath,
      text: remaining.slice(0, 500),
    });
  }

  return sections;
}

const files = collectAstroFiles(PAGES_DIR);
const index = [];

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  const pagePath = fileToPath(file);
  const pageTitle = extractTitle(content);
  const sections = extractSections(content, pagePath, pageTitle);
  for (const s of sections) {
    index.push({ ...s, page: pageTitle });
  }
}

writeFileSync(OUT_FILE, JSON.stringify(index));
console.log(`Search index: ${index.length} sections from ${files.length} pages → ${OUT_FILE}`);
