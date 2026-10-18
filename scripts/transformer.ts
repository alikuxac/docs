import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import matter from 'gray-matter';

export interface ITransformOptions {
  repoId: string;
  refName: string;
  sourceDocRoot: string;
  destDocDir: string;
  publicAssetDir: string;
  repoRemoteUrl: string;
  badgeLabel?: string;
  badgeVariant?: 'note' | 'tip' | 'danger' | 'caution' | 'success' | 'default';
  isProjectOverview?: boolean;
  fallbackTitle?: string;
}

export class DocTransformer {
  public static async processFile(
    sourceFilePath: string,
    relativeFilePath: string,
    options: ITransformOptions
  ): Promise<string> {
    try {
      const rawContent = await fs.readFile(sourceFilePath, 'utf-8');
      const parsed = matter(rawContent);

      const title = this.resolveTitle(parsed, rawContent, relativeFilePath, options);
      const cleanedBody = this.stripLeadingH1(parsed.content);
      const sanitizedBody = this.sanitizeLatexNotation(cleanedBody);
      const updatedData = this.buildFrontmatter(parsed.data, title, sanitizedBody, options);

      let transformedBody = await this.rewriteAssetsAndLinks(
        sanitizedBody,
        path.dirname(sourceFilePath),
        options
      );

      transformedBody = this.transformLoaderTabs(transformedBody);
      const { finalBody, finalRelPath } = this.handleComponentsAndExtension(
        transformedBody,
        relativeFilePath
      );

      const outputContent = matter.stringify(finalBody, updatedData);
      const targetFilePath = path.join(options.destDocDir, finalRelPath);

      await fs.mkdir(path.dirname(targetFilePath), { recursive: true });
      await fs.writeFile(targetFilePath, outputContent, 'utf-8');
      return targetFilePath;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to process ${sourceFilePath}: ${errMsg}`);
    }
  }

  private static sanitizeLatexNotation(content: string): string {
    return content
      .replace(/\$\\lceil\s*([^$\\]+?)(?:\\%)?\s*\\rceil\$/g, '$1%')
      .replace(/\$\\lfloor\s*([^$]+?)\s*\\rfloor\$/g, '$1')
      .replace(/\$\\ge\s*([^$]+?)\$/g, '≥ $1')
      .replace(/\$\\le\s*([^$]+?)\$/g, '≤ $1')
      .replace(/\$([-+]?\d+(?:\.\d+)?)\\%?\$/g, '$1%')
      .replace(/\$([-+]?\d+(?:\.\d+)?)\$/g, '$1');
  }

  private static stripLeadingH1(content: string): string {
    return content.replace(/^\s*#\s+[^\r\n]+(\r?\n)+/, '');
  }

  private static handleComponentsAndExtension(
    body: string,
    relPath: string
  ): { finalBody: string; finalRelPath: string } {
    const syncedBody = body.replace(/<Tabs(?!\s+[^>]*\bsyncKey=)\b/g, '<Tabs syncKey="modloader"');
    const hasComponents = /<(Tabs|TabItem|Card|CardGrid|Badge|Aside)\b/.test(syncedBody);
    if (!hasComponents) {
      return { finalBody: body, finalRelPath: relPath };
    }

    const finalRelPath = relPath.endsWith('.md') ? relPath.slice(0, -3) + '.mdx' : relPath;
    const finalBody = this.injectComponentImports(syncedBody);
    return { finalBody, finalRelPath };
  }

  private static transformLoaderTabs(content: string): string {
    const blockRegex = /:::loader-tabs\s*\n([\s\S]*?)\n:::/g;
    return content.replace(blockRegex, (_match, blockContent: string) => {
      const parts = blockContent.split(/^###\s+(.+)$/m);
      if (parts.length < 3) return blockContent;

      const tabs: string[] = [];
      for (let i = 1; i < parts.length; i += 2) {
        const label = parts[i].trim();
        const tabBody = parts[i + 1]?.trim() ?? '';
        tabs.push(`  <TabItem label="${label}">\n\n${tabBody}\n\n  </TabItem>`);
      }

      return `<Tabs syncKey="modloader">\n${tabs.join('\n')}\n</Tabs>`;
    });
  }

  private static injectComponentImports(body: string): string {
    const needed: string[] = [];
    if (/<(Tabs|TabItem)\b/.test(body) && !/import\s+{[^}]*\b(Tabs|TabItem)\b[^}]*}\s+from/.test(body)) {
      needed.push('Tabs', 'TabItem');
    }
    if (/<(Card|CardGrid)\b/.test(body) && !/import\s+{[^}]*\b(Card|CardGrid)\b[^}]*}\s+from/.test(body)) {
      needed.push('Card', 'CardGrid');
    }
    if (/<Badge\b/.test(body) && !/import\s+{[^}]*\bBadge\b[^}]*}\s+from/.test(body)) {
      needed.push('Badge');
    }
    if (/<Aside\b/.test(body) && !/import\s+{[^}]*\bAside\b[^}]*}\s+from/.test(body)) {
      needed.push('Aside');
    }

    if (needed.length === 0) return body;
    const importStatement = `import { ${Array.from(new Set(needed)).join(', ')} } from '@astrojs/starlight/components';\n\n`;
    return importStatement + body;
  }

  private static resolveTitle(
    parsed: matter.GrayMatterFile<string>,
    rawContent: string,
    relativeFilePath: string,
    options?: ITransformOptions
  ): string {
    if (parsed.data.title && typeof parsed.data.title === 'string' && parsed.data.title.trim().length > 0) {
      return parsed.data.title.trim();
    }
    const headingMatch = rawContent.match(/^#\s+(.+)$/m);
    if (headingMatch?.[1]) {
      return headingMatch[1].trim();
    }
    const baseName = path.basename(relativeFilePath, path.extname(relativeFilePath));
    if (baseName.toLowerCase() === 'index' || baseName.toLowerCase() === 'readme') {
      if (options?.fallbackTitle) {
        return options.fallbackTitle;
      }
      if (options?.repoId) {
        return options.repoId.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }
    return baseName.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private static buildFrontmatter(
    existingData: Record<string, unknown>,
    title: string,
    body: string,
    options: ITransformOptions
  ): Record<string, unknown> {
    const description = this.resolveDescription(existingData, body, title, options);
    const keywords = this.generateKeywords(title, body, options);

    const head = Array.isArray(existingData.head) ? [...existingData.head] : [];

    const hasKeywords = head.some(
      (item: unknown) =>
        item &&
        typeof item === 'object' &&
        'attrs' in item &&
        typeof (item as { attrs?: { name?: string } }).attrs?.name === 'string' &&
        (item as { attrs: { name: string } }).attrs.name.toLowerCase() === 'keywords'
    );
    if (!hasKeywords && keywords) {
      head.push({
        tag: 'meta',
        attrs: { name: 'keywords', content: keywords },
      });
    }

    const hasOgType = head.some(
      (item: unknown) =>
        item &&
        typeof item === 'object' &&
        'attrs' in item &&
        (item as { attrs?: { property?: string } }).attrs?.property === 'og:type'
    );
    if (!hasOgType) {
      head.push({
        tag: 'meta',
        attrs: { property: 'og:type', content: 'article' },
      });
    }

    return {
      ...existingData,
      title,
      description,
      ...(head.length > 0 ? { head } : {}),
    };
  }

  private static resolveDescription(
    existingData: Record<string, unknown>,
    body: string,
    title: string,
    options: ITransformOptions
  ): string {
    if (typeof existingData.description === 'string' && existingData.description.trim().length > 0) {
      return existingData.description.trim();
    }

    const extracted = this.extractSummaryFromBody(body);
    if (extracted) {
      return extracted;
    }

    const repoName = options.fallbackTitle ?? options.repoId.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    if (options.isProjectOverview) {
      return `Technical overview, architecture, and documentation guide for ${repoName}.`;
    }
    return `Technical guide and configuration documentation for ${title} in ${repoName} (${options.refName}).`;
  }

  private static extractSummaryFromBody(body: string): string | null {
    let cleaned = body.replace(/```[\s\S]*?```/g, '');
    cleaned = cleaned.replace(/~~~[\s\S]*?~~~/g, '');
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
    cleaned = cleaned.replace(/:::[a-zA-Z0-9_-]+[\s\S]*?:::/g, '');
    cleaned = cleaned.replace(/<[^>]+>/g, '');

    const paragraphs = cleaned.split(/\n\s*\n/);
    for (const rawPara of paragraphs) {
      let p = rawPara.trim();
      if (!p) continue;

      if (/^(\||#|>|---|\*\*\*|___)/.test(p)) continue;
      if (/^(!\[|<img)/.test(p)) continue;

      p = p.replace(/!\[.*?\]\(.*?\)/g, '');
      p = p.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      p = p.replace(/`([^`]+)`/g, '$1');
      p = p.replace(/(\*\*|__)(.*?)\1/g, '$2');
      p = p.replace(/(\*|_)(.*?)\1/g, '$2');
      p = p.replace(/~~(.*?)~~/g, '$1');
      p = p.replace(/^(\*|-|\+|\d+\.)\s+/gm, '');
      p = p.replace(/\s+/g, ' ').trim();

      if (p.length >= 25) {
        if (p.length <= 160) {
          return p;
        }
        const truncated = p.slice(0, 155);
        const lastSpace = truncated.lastIndexOf(' ');
        const cut = lastSpace > 100 ? truncated.slice(0, lastSpace) : truncated;
        return `${cut}...`;
      }
    }
    return null;
  }

  private static generateKeywords(
    title: string,
    body: string,
    options: ITransformOptions
  ): string {
    const keywordsSet = new Set<string>();

    keywordsSet.add('minecraft');
    keywordsSet.add('minecraft mod');
    keywordsSet.add(options.repoId.toLowerCase());
    keywordsSet.add(options.repoId.replace(/[-_]/g, ' ').toLowerCase());
    keywordsSet.add(options.refName.toLowerCase());
    keywordsSet.add('configuration');
    keywordsSet.add('documentation');
    keywordsSet.add('guide');

    if (options.isProjectOverview) {
      keywordsSet.add('overview');
      keywordsSet.add('project overview');
    }

    const titleClean = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const titleWords = titleClean.split(/\s+/).filter((w) => w.length > 2);
    for (const word of titleWords) {
      keywordsSet.add(word);
    }

    const headingMatches = body.matchAll(/^#{2,3}\s+(.+)$/gm);
    for (const match of headingMatches) {
      const heading = match[1]
        ?.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .trim();
      if (heading && heading.length > 2 && heading.length < 30) {
        keywordsSet.add(heading);
      }
      if (keywordsSet.size >= 12) break;
    }

    return Array.from(keywordsSet).slice(0, 15).join(', ');
  }

  private static async rewriteAssetsAndLinks(
    content: string,
    sourceFileDir: string,
    options: ITransformOptions
  ): Promise<string> {
    let result = await this.rewriteImages(content, sourceFileDir, options);
    result = this.rewriteRelativeCodeLinks(result, options);
    return result;
  }

  private static async rewriteImages(
    content: string,
    sourceFileDir: string,
    options: ITransformOptions
  ): Promise<string> {
    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const matches = Array.from(content.matchAll(imgRegex));
    let modified = content;

    for (const match of matches) {
      const [fullMatch, alt, rawUrl] = match;
      if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('/') || rawUrl.startsWith('data:')) {
        continue;
      }
      const localAssetPath = path.resolve(sourceFileDir, rawUrl);
      const isFile = await this.checkFileExists(localAssetPath);
      if (!isFile) continue;

      const relToDocRoot = path.relative(options.sourceDocRoot, localAssetPath);
      const safeRelAssetPath = relToDocRoot.startsWith('..')
        ? path.basename(rawUrl)
        : relToDocRoot.replace(/\\/g, '/');

      const assetSubPath = path.join(options.repoId, options.refName, safeRelAssetPath);
      const targetPublicPath = path.join(options.publicAssetDir, assetSubPath);
      await fs.mkdir(path.dirname(targetPublicPath), { recursive: true });
      await fs.copyFile(localAssetPath, targetPublicPath);

      const webPath = `/docs-assets/${options.repoId}/${options.refName}/${safeRelAssetPath}`;
      modified = modified.replace(fullMatch, `![${alt}](${webPath})`);
    }
    return modified;
  }

  private static rewriteRelativeCodeLinks(
    content: string,
    options: ITransformOptions
  ): string {
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const cleanRemote = options.repoRemoteUrl.replace(/\.git$/, '');

    return content.replace(linkRegex, (match, text, url) => {
      if (
        url.startsWith('http://') ||
        url.startsWith('https://') ||
        url.startsWith('/') ||
        url.startsWith('#') ||
        url.startsWith('mailto:')
      ) {
        return match;
      }
      if (url.endsWith('.md') || url.endsWith('.mdx')) {
        return match;
      }
      const cleanPath = url.replace(/^\.\//, '');
      const githubUrl = `${cleanRemote}/blob/${options.refName}/${cleanPath}`;
      return `[${text}](${githubUrl})`;
    });
  }

  private static async checkFileExists(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }
}
