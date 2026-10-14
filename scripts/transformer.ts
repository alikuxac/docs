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

      const title = this.resolveTitle(parsed, rawContent, relativeFilePath);
      const updatedData = this.buildFrontmatter(parsed.data, title, options);
      const cleanedBody = this.stripLeadingH1(parsed.content);
      const sanitizedBody = this.sanitizeLatexNotation(cleanedBody);
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
    relativeFilePath: string
  ): string {
    if (parsed.data.title && typeof parsed.data.title === 'string') {
      return parsed.data.title;
    }
    const headingMatch = rawContent.match(/^#\s+(.+)$/m);
    if (headingMatch?.[1]) {
      return headingMatch[1].trim();
    }
    const baseName = path.basename(relativeFilePath, path.extname(relativeFilePath));
    return baseName.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private static buildFrontmatter(
    existingData: Record<string, unknown>,
    title: string,
    _options: ITransformOptions
  ): Record<string, unknown> {
    return {
      ...existingData,
      title,
    };
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
      if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('/')) {
        continue;
      }
      const localAssetPath = path.resolve(sourceFileDir, rawUrl);
      const isFile = await this.checkFileExists(localAssetPath);
      if (!isFile) continue;

      const assetSubPath = path.join(options.repoId, options.refName, path.basename(rawUrl));
      const targetPublicPath = path.join(options.publicAssetDir, assetSubPath);
      await fs.mkdir(path.dirname(targetPublicPath), { recursive: true });
      await fs.copyFile(localAssetPath, targetPublicPath);

      const webPath = `/docs-assets/${options.repoId}/${options.refName}/${path.basename(rawUrl)}`;
      modified = modified.replace(fullMatch, `![${alt}](${webPath})`);
    }
    return modified;
  }

  private static rewriteRelativeCodeLinks(
    content: string,
    options: ITransformOptions
  ): string {
    const linkRegex = /\[([^\]]+)\]\(((\.\.\/|\.\/)[^)]+)\)/g;
    const cleanRemote = options.repoRemoteUrl.replace(/\.git$/, '');

    return content.replace(linkRegex, (match, text, url) => {
      if (url.endsWith('.md') || url.endsWith('.mdx')) {
        return match;
      }
      const githubUrl = `${cleanRemote}/blob/${options.refName}/${url.replace(/^\.\//, '')}`;
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
