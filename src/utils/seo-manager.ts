import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { slug } from 'github-slugger';

export interface ISitemapMetaEntry {
  url: string;
  hash: string;
  title?: string;
  description?: string;
  lastmod: string;
  filePath: string;
}

export type ISitemapMetadataMap = Record<string, ISitemapMetaEntry>;

const SITE_URL = 'https://docs.alikuxac.xyz';
const CACHE_DIR = path.resolve(process.cwd(), '.cache');
const METADATA_FILE = path.join(CACHE_DIR, 'sitemap-metadata.json');
const CHANGED_URLS_FILE = path.join(CACHE_DIR, 'changed-urls.json');

let cachedMetadata: ISitemapMetadataMap | null = null;

export function toAstroSlug(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/\.(md|mdx)$/, '');
  if (normalized === 'index') return '';
  return normalized
    .split('/')
    .filter(Boolean)
    .map((segment) => slug(segment))
    .join('/')
    .replace(/\/index$/, '');
}

export async function initSitemapMetadata(): Promise<{
  metadata: ISitemapMetadataMap;
  changedUrls: string[];
}> {
  await fs.mkdir(CACHE_DIR, { recursive: true });

  let previousMetadata: ISitemapMetadataMap = {};
  try {
    const raw = await fs.readFile(METADATA_FILE, 'utf-8');
    previousMetadata = JSON.parse(raw);
  } catch {
    previousMetadata = {};
  }

  const docsRoot = path.resolve(process.cwd(), 'src/content/docs');
  const files = await fg('**/*.{md,mdx}', { cwd: docsRoot, absolute: false });

  const currentMetadata: ISitemapMetadataMap = {};
  const changedUrls: string[] = [];
  const nowIso = new Date().toISOString();

  for (const relPath of files) {
    const fullPath = path.join(docsRoot, relPath);
    let rawContent: string;
    try {
      rawContent = await fs.readFile(fullPath, 'utf-8');
    } catch {
      continue;
    }

    const hash = crypto.createHash('sha256').update(rawContent).digest('hex');
    const slugStr = toAstroSlug(relPath);
    const url = `${SITE_URL}/${slugStr ? slugStr + '/' : ''}`;

    let parsedTitle: string | undefined;
    let parsedDescription: string | undefined;
    try {
      const parsed = matter(rawContent);
      if (typeof parsed.data.title === 'string' && parsed.data.title.trim()) {
        parsedTitle = parsed.data.title.trim();
      }
      if (typeof parsed.data.description === 'string' && parsed.data.description.trim()) {
        parsedDescription = parsed.data.description.trim();
      }
    } catch {
    }

    const prev = previousMetadata[url];
    let lastmod: string;

    if (prev && prev.hash === hash && prev.lastmod) {
      lastmod = prev.lastmod;
    } else {
      lastmod = nowIso;
      changedUrls.push(url);
    }

    currentMetadata[url] = {
      url,
      hash,
      title: parsedTitle || slugStr || 'Documentation',
      description: parsedDescription,
      lastmod,
      filePath: relPath,
    };
  }

  cachedMetadata = currentMetadata;

  await fs.writeFile(METADATA_FILE, JSON.stringify(currentMetadata, null, 2), 'utf-8');
  await fs.writeFile(CHANGED_URLS_FILE, JSON.stringify(changedUrls, null, 2), 'utf-8');

  console.log(
    `[SEO] Initialized sitemap metadata: ${Object.keys(currentMetadata).length} total pages, ${changedUrls.length} changed in this run.`
  );

  return { metadata: currentMetadata, changedUrls };
}

export function getSerializedSitemapItem(item: {
  url: string;
  changefreq?: string;
  priority?: number;
  lastmod?: string | Date;
  links?: unknown[];
}) {
  const meta = cachedMetadata?.[item.url];

  if (meta?.lastmod) {
    item.lastmod = new Date(meta.lastmod);
  }

  const pathname = new URL(item.url).pathname;

  if (pathname === '/' || pathname === '') {
    item.priority = 1.0;
    item.changefreq = 'daily';
  } else if (
    pathname.includes('/changelog') ||
    pathname.includes('/versions') ||
    pathname === '/about/'
  ) {
    item.priority = 0.9;
    item.changefreq = 'daily';
  } else {
    item.priority = 0.8;
    item.changefreq = 'weekly';
  }

  return item;
}

export async function generateRssFeed(outDir: string): Promise<void> {
  const metadata = cachedMetadata ?? {};
  const entries = Object.values(metadata);

  if (entries.length === 0) return;

  entries.sort((a, b) => new Date(b.lastmod).getTime() - new Date(a.lastmod).getTime());
  const feedItems = entries.slice(0, 30);

  const rssItemsXml = feedItems
    .map((item) => {
      const pubDate = new Date(item.lastmod).toUTCString();
      const desc = item.description || `Documentation updates for ${item.title || item.url}`;
      return `    <item>
      <title><![CDATA[${item.title || 'Documentation Page'}]]></title>
      <link>${item.url}</link>
      <guid isPermaLink="true">${item.url}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${desc}]]></description>
    </item>`;
    })
    .join('\n');

  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Alikuxac Documentation Updates</title>
    <link>${SITE_URL}/</link>
    <description>Recently updated documentation, configuration guides, and references.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml"/>
${rssItemsXml}
  </channel>
</rss>`;

  const rssPath = path.join(outDir, 'rss.xml');
  await fs.writeFile(rssPath, rssXml, 'utf-8');
  console.log(`[SEO] Generated RSS Feed with ${feedItems.length} items at dist/rss.xml`);
}

export function docsSeoIntegration(): import('astro').AstroIntegration {
  return {
    name: 'docs-seo-integration',
    hooks: {
      'astro:config:setup': async () => {
        await initSitemapMetadata();
      },
      'astro:build:done': async ({ dir }) => {
        const outDir = fileURLToPath(dir);
        await generateRssFeed(outDir);
      },
    },
  };
}

