import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import fg from 'fast-glob';
import docsConfig from '../docs.config.js';
import type {
  IDocsConfig,
  IMinecraftModRepoConfig,
  IStandardRepoConfig,
  ISidebarGroup,
  ISidebarItem,
} from './types.js';
import { GitClient } from './git-client.js';
import { DocTransformer } from './transformer.js';
import { LifecyclePageGenerator } from './lifecycle-generator.js';
import { ChangelogPageGenerator } from './changelog-generator.js';
import { slug } from 'github-slugger';

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

interface ISyncContext {
  config: IDocsConfig;
  cleanRequested: boolean;
  targetRepoId?: string;
  cacheBaseDir: string;
  contentBaseDir: string;
  publicAssetDir: string;
}

export class DocSyncEngine {
  public static async run(): Promise<void> {
    const ctx = this.parseContext();
    console.log('[DocSync] Starting documentation synchronization pipeline...');

    await fs.mkdir(ctx.cacheBaseDir, { recursive: true });
    await fs.mkdir(ctx.contentBaseDir, { recursive: true });
    await fs.mkdir(ctx.publicAssetDir, { recursive: true });

    const sidebarCategoryMap = new Map<string, ISidebarItem[]>();

    for (const repo of ctx.config.repositories) {
      if (ctx.targetRepoId && repo.id !== ctx.targetRepoId) continue;
      console.log(`\n[DocSync] Processing repository: ${repo.name} (${repo.id}) [${repo.type}]`);

      try {
        if (repo.type === 'minecraft-mod') {
          const group = await this.syncMinecraftMod(repo, ctx);
          if (group && group.items.length > 0) {
            const list = sidebarCategoryMap.get(group.label) ?? [];
            list.push(...group.items);
            sidebarCategoryMap.set(group.label, list);
          }
        } else if (repo.type === 'standard') {
          const group = await this.syncStandardRepo(repo, ctx);
          if (group && group.items.length > 0) {
            const list = sidebarCategoryMap.get(group.label) ?? [];
            list.push(...group.items);
            sidebarCategoryMap.set(group.label, list);
          }
        }
      } catch (err: unknown) {
        console.error(`[DocSync] ERROR processing repo ${repo.id}:`, err);
      }
    }

    const sidebarGroups: ISidebarGroup[] = Array.from(sidebarCategoryMap.entries()).map(
      ([label, items]) => ({ label, items })
    );

    await this.writeSidebarOutput(sidebarGroups);
    console.log('\n[DocSync] Done! All documentation sources processed.');
  }

  private static parseContext(): ISyncContext {
    const args = process.argv.slice(2);
    const repoIndex = args.indexOf('--repo');
    const targetRepoId = repoIndex !== -1 ? args[repoIndex + 1] : undefined;
    const cleanRequested = args.includes('--clean');

    return {
      config: docsConfig,
      cleanRequested,
      targetRepoId,
      cacheBaseDir: path.resolve(process.cwd(), docsConfig.cacheDir ?? '.cache/doc-repos'),
      contentBaseDir: path.resolve(process.cwd(), docsConfig.targetContentDir ?? 'src/content/docs'),
      publicAssetDir: path.resolve(process.cwd(), docsConfig.publicAssetDir ?? 'public/docs-assets'),
    };
  }

  private static async syncMinecraftMod(
    repo: IMinecraftModRepoConfig,
    ctx: ISyncContext
  ): Promise<ISidebarGroup | null> {
    const repoCacheDir = path.join(ctx.cacheBaseDir, repo.id);
    await GitClient.ensureRepoClone(repo.remote, repoCacheDir);

    if (ctx.cleanRequested) {
      await fs.rm(path.join(ctx.publicAssetDir, repo.id), { recursive: true, force: true });
      await fs.rm(path.join(ctx.contentBaseDir, 'mods', repo.id, 'index.md'), { force: true });
      await fs.rm(path.join(ctx.contentBaseDir, 'mods', repo.id, 'index.mdx'), { force: true });
    }

    const versionItems: ISidebarItem[] = [];
    const resolvedTags = new Map<string, string>();
    const docLinks = new Map<string, string>();

    const hasProjectOverview = await this.syncProjectOverview(
      repo,
      repoCacheDir,
      ctx,
      'mods',
      repo.versions[0] ?? 'main'
    );

    for (let i = 0; i < repo.versions.length; i++) {
      const version = repo.versions[i];
      const hasBranch = await GitClient.hasBranch(repoCacheDir, version);
      if (!hasBranch) {
        console.warn(`[DocSync] Branch 'origin/${version}' not found for ${repo.id}, skipping.`);
        continue;
      }

      const lifecycleEntry = repo.lifecycle?.find((l) => l.version === version);
      const isStatusActive = !lifecycleEntry || lifecycleEntry.status === 'active';

      const useTags = repo.tagStrategy !== 'branch-head';
      const latestTag = useTags
        ? await GitClient.getLatestTagOnBranch(repoCacheDir, version, {
            version,
            allKnownVersions: repo.versions,
            tagPattern: repo.tagPattern,
          })
        : null;

      if (latestTag) {
        resolvedTags.set(version, latestTag);
      }

      const stableRef = latestTag ?? `origin/${version}`;
      const stableBadgeText = latestTag ? `MC ${version} (${latestTag})` : `MC ${version}`;
      const stableDestDir = path.join(ctx.contentBaseDir, 'mods', repo.id, version);
      const devVersionKey = `${version}-dev`;
      const devDestDir = path.join(ctx.contentBaseDir, 'mods', repo.id, devVersionKey);

      if (ctx.cleanRequested) {
        await fs.rm(stableDestDir, { recursive: true, force: true });
        await fs.rm(devDestDir, { recursive: true, force: true });
      }

      const { count: stableCount, firstFileRelPath } = await this.extractAndTransformDocs({
        repoCacheDir,
        ref: stableRef,
        docRoot: repo.docRoot ?? 'docs',
        destDir: stableDestDir,
        publicAssetDir: ctx.publicAssetDir,
        repoId: repo.id,
        repoRemote: repo.remote,
        badgeLabel: stableBadgeText,
        badgeVariant: 'note',
      });

      if (stableCount > 0) {
        const slugVersion = toAstroSlug(version);
        const slugRelPath = firstFileRelPath ? toAstroSlug(firstFileRelPath) : '';
        const link = slugRelPath
          ? `/mods/${repo.id}/${slugVersion}/${slugRelPath}/`
          : `/mods/${repo.id}/${slugVersion}/`;
        docLinks.set(version, link);

        versionItems.push({
          label: `Minecraft ${version}`,
          badge: { text: stableBadgeText, variant: 'note' },
          collapsed: true,
          items: [
            {
              autogenerate: {
                directory: `mods/${repo.id}/${version}`,
              },
            },
          ],
        });
      }

      let devTrackGenerated = false;
      if (latestTag && isStatusActive) {
        const isHeadSameAsTag = await GitClient.isBranchHeadSameAsTag(
          repoCacheDir,
          version,
          latestTag
        );

        if (!isHeadSameAsTag) {
          console.log(`[DocSync] Generating Dev Preview for ${repo.id} (${version}) from origin/${version}`);
          const { count: devCount } = await this.extractAndTransformDocs({
            repoCacheDir,
            ref: `origin/${version}`,
            docRoot: repo.docRoot ?? 'docs',
            destDir: devDestDir,
            publicAssetDir: ctx.publicAssetDir,
            repoId: repo.id,
            repoRemote: repo.remote,
            badgeLabel: `MC ${version} (Dev)`,
            badgeVariant: 'caution',
          });

          if (devCount > 0) {
            devTrackGenerated = true;
            versionItems.push({
              label: `Minecraft ${version} (Dev)`,
              badge: { text: 'Dev', variant: 'caution' },
              collapsed: true,
              items: [
                {
                  autogenerate: {
                    directory: `mods/${repo.id}/${devVersionKey}`,
                  },
                },
              ],
            });
          }
        }
      }

      if (!devTrackGenerated) {
        await fs.rm(devDestDir, { recursive: true, force: true });
      }
    }

    const hasLifecycle = Boolean(repo.lifecycle && repo.lifecycle.length > 0);
    if (hasLifecycle) {
      const versionsFilePath = path.join(ctx.contentBaseDir, 'mods', repo.id, 'versions.md');
      await LifecyclePageGenerator.generate({
        repo,
        targetFilePath: versionsFilePath,
        resolvedTags,
        docLinks,
      });

      versionItems.unshift({
        label: 'Version Support',
        link: `/mods/${repo.id}/versions/`,
        badge: { text: 'Matrix', variant: 'tip' },
      });
    }

    const changelogFilePath = path.join(ctx.contentBaseDir, 'mods', repo.id, 'changelog.md');
    const hasChangelog = await ChangelogPageGenerator.generate({
      repo,
      targetFilePath: changelogFilePath,
    });

    if (hasChangelog) {
      const changelogItem: ISidebarItem = {
        label: 'Changelog',
        link: `/mods/${repo.id}/changelog/`,
        badge: { text: 'Releases', variant: 'note' },
      };
      if (hasLifecycle) {
        versionItems.splice(1, 0, changelogItem);
      } else {
        versionItems.unshift(changelogItem);
      }
    }

    if (hasProjectOverview) {
      versionItems.unshift({
        label: 'Overview',
        link: `/mods/${repo.id}/`,
      });
    }

    if (versionItems.length === 0) return null;

    return {
      label: repo.category ?? 'Minecraft Mods',
      items: [
        {
          label: repo.name,
          collapsed: true,
          items: versionItems,
        },
      ],
    };
  }

  private static async syncStandardRepo(
    repo: IStandardRepoConfig,
    ctx: ISyncContext
  ): Promise<ISidebarGroup | null> {
    const repoCacheDir = path.join(ctx.cacheBaseDir, repo.id);
    await GitClient.ensureRepoClone(repo.remote, repoCacheDir);

    if (ctx.cleanRequested) {
      await fs.rm(path.join(ctx.publicAssetDir, repo.id), { recursive: true, force: true });
      await fs.rm(path.join(ctx.contentBaseDir, 'projects', repo.id, 'index.md'), { force: true });
      await fs.rm(path.join(ctx.contentBaseDir, 'projects', repo.id, 'index.mdx'), { force: true });
    }

    const branchItems: ISidebarItem[] = [];

    const hasProjectOverview = await this.syncProjectOverview(
      repo,
      repoCacheDir,
      ctx,
      'projects',
      repo.branches.stable.branch
    );

    const stableDef = repo.branches.stable;
    const stableSubPath = stableDef.subPath ?? 'stable';
    const stableTargetDir = path.join(ctx.contentBaseDir, 'projects', repo.id, stableSubPath);
    if (ctx.cleanRequested) {
      await fs.rm(stableTargetDir, { recursive: true, force: true });
    }

    const { count: stableCount } = await this.extractAndTransformDocs({
      repoCacheDir,
      ref: `origin/${stableDef.branch}`,
      docRoot: repo.docRoot ?? 'docs',
      destDir: stableTargetDir,
      publicAssetDir: ctx.publicAssetDir,
      repoId: repo.id,
      repoRemote: repo.remote,
      badgeLabel: stableDef.displayName,
      badgeVariant: 'success',
    });

    if (stableCount > 0) {
      branchItems.push({
        label: stableDef.displayName,
        badge: { text: stableDef.displayName, variant: 'success' },
        items: [
          {
            autogenerate: {
              directory: `projects/${repo.id}/${stableSubPath}`,
            },
          },
        ],
      });
    }

    if (repo.branches.development) {
      const devDef = repo.branches.development;
      const devSubPath = devDef.subPath ?? 'dev';
      const devTargetDir = path.join(ctx.contentBaseDir, 'projects', repo.id, devSubPath);

      const hasDev = await GitClient.hasBranch(repoCacheDir, devDef.branch);
      if (hasDev) {
        if (ctx.cleanRequested) {
          await fs.rm(devTargetDir, { recursive: true, force: true });
        }

        const { count: devCount } = await this.extractAndTransformDocs({
          repoCacheDir,
          ref: `origin/${devDef.branch}`,
          docRoot: repo.docRoot ?? 'docs',
          destDir: devTargetDir,
          publicAssetDir: ctx.publicAssetDir,
          repoId: repo.id,
          repoRemote: repo.remote,
          badgeLabel: devDef.displayName,
          badgeVariant: 'caution',
        });

        if (devCount > 0) {
          branchItems.push({
            label: devDef.displayName,
            badge: { text: devDef.displayName, variant: 'caution' },
            items: [
              {
                autogenerate: {
                  directory: `projects/${repo.id}/${devSubPath}`,
                },
              },
            ],
          });
        }
      }
    }

    const hasLifecycle = Boolean(repo.lifecycle && repo.lifecycle.length > 0);
    if (hasLifecycle) {
      const versionsFilePath = path.join(ctx.contentBaseDir, 'projects', repo.id, 'versions.md');
      await LifecyclePageGenerator.generate({
        repo,
        targetFilePath: versionsFilePath,
        resolvedTags: new Map(),
        docLinks: new Map(),
      });

      branchItems.unshift({
        label: 'Version Support',
        link: `/projects/${repo.id}/versions/`,
        badge: { text: 'Matrix', variant: 'tip' },
      });
    }

    const changelogFilePath = path.join(ctx.contentBaseDir, 'projects', repo.id, 'changelog.md');
    const hasChangelog = await ChangelogPageGenerator.generate({
      repo,
      targetFilePath: changelogFilePath,
    });

    if (hasChangelog) {
      const changelogItem: ISidebarItem = {
        label: 'Changelog',
        link: `/projects/${repo.id}/changelog/`,
        badge: { text: 'Releases', variant: 'note' },
      };
      if (hasLifecycle) {
        branchItems.splice(1, 0, changelogItem);
      } else {
        branchItems.unshift(changelogItem);
      }
    }

    if (hasProjectOverview) {
      branchItems.unshift({
        label: 'Overview',
        link: `/projects/${repo.id}/`,
      });
    }

    if (branchItems.length === 0) return null;

    return {
      label: repo.category ?? 'Projects',
      items: [
        {
          label: repo.name,
          collapsed: true,
          items: branchItems,
        },
      ],
    };
  }

  private static async extractAndTransformDocs(params: {
    repoCacheDir: string;
    ref: string;
    docRoot: string;
    destDir: string;
    publicAssetDir: string;
    repoId: string;
    repoRemote: string;
    badgeLabel?: string;
    badgeVariant?: 'note' | 'tip' | 'danger' | 'caution' | 'success' | 'default';
  }): Promise<{ count: number; firstFileRelPath?: string }> {
    await GitClient.checkoutSparse(params.repoCacheDir, params.ref, params.docRoot);

    const fullDocRoot = path.join(params.repoCacheDir, params.docRoot);
    const hasDocRoot = await this.checkDir(fullDocRoot);
    let count = 0;
    let firstFileRelPath: string | undefined;

    if (hasDocRoot) {
      const allMdFiles = await fg('**/*.{md,mdx}', { cwd: fullDocRoot });
      const versionFiles: Array<{ sourcePath: string; relFile: string }> = [];
      let localIndexFile: string | undefined;

      for (const relFile of allMdFiles) {
        const normalizedRel = relFile.replace(/\\/g, '/');
        const parts = normalizedRel.split('/');

        if (parts.length === 1 && /^index\.(md|mdx)$/i.test(parts[0])) {
          localIndexFile = path.join(fullDocRoot, relFile);
          continue;
        }
        if (parts.length === 1 && /^readme\.(md|mdx)$/i.test(parts[0])) {
          if (!localIndexFile) {
            localIndexFile = path.join(fullDocRoot, relFile);
          }
          continue;
        }

        let targetRelFile: string;
        if (parts.length === 1) {
          targetRelFile = parts[0];
        } else if (parts.length === 2) {
          targetRelFile = normalizedRel;
        } else {
          const [folder, ...subParts] = parts;
          targetRelFile = `${folder}/${subParts.join('-')}`;
          console.log(`[DocSync] Flattening deeper nested file '${normalizedRel}' to 1 folder: '${targetRelFile}'`);
        }

        versionFiles.push({
          sourcePath: path.join(fullDocRoot, relFile),
          relFile: targetRelFile,
        });
      }

      if (versionFiles.length === 0 && localIndexFile) {
        await DocTransformer.processFile(localIndexFile, 'index.md', {
          repoId: params.repoId,
          refName: params.ref.replace(/^origin\//, ''),
          sourceDocRoot: path.dirname(localIndexFile),
          destDocDir: params.destDir,
          publicAssetDir: params.publicAssetDir,
          repoRemoteUrl: params.repoRemote,
          badgeLabel: params.badgeLabel,
          badgeVariant: params.badgeVariant,
        });
        count++;
        firstFileRelPath = '';
      } else {
        for (const item of versionFiles) {
          if (!firstFileRelPath) {
            firstFileRelPath = toAstroSlug(item.relFile);
          }
          await DocTransformer.processFile(item.sourcePath, item.relFile, {
            repoId: params.repoId,
            refName: params.ref.replace(/^origin\//, ''),
            sourceDocRoot: fullDocRoot,
            destDocDir: params.destDir,
            publicAssetDir: params.publicAssetDir,
            repoRemoteUrl: params.repoRemote,
            badgeLabel: params.badgeLabel,
            badgeVariant: params.badgeVariant,
          });
          count++;
        }
      }
    } else {
      const rootReadme = path.join(params.repoCacheDir, 'README.md');
      const hasReadme = await this.checkFile(rootReadme);
      if (hasReadme) {
        firstFileRelPath = '';
        await DocTransformer.processFile(rootReadme, 'index.md', {
          repoId: params.repoId,
          refName: params.ref.replace(/^origin\//, ''),
          sourceDocRoot: params.repoCacheDir,
          destDocDir: params.destDir,
          publicAssetDir: params.publicAssetDir,
          repoRemoteUrl: params.repoRemote,
          badgeLabel: params.badgeLabel,
          badgeVariant: params.badgeVariant,
        });
        count++;
      }
    }
    return { count, firstFileRelPath };
  }

  private static async syncProjectOverview(
    repo: IMinecraftModRepoConfig | IStandardRepoConfig,
    repoCacheDir: string,
    ctx: ISyncContext,
    contentType: 'mods' | 'projects',
    fallbackBranch: string
  ): Promise<boolean> {
    const defaultBranch = await GitClient.getDefaultBranch(repoCacheDir, fallbackBranch);
    await GitClient.checkoutSparse(repoCacheDir, `origin/${defaultBranch}`, repo.docRoot ?? 'docs');

    const docRootDir = path.join(repoCacheDir, repo.docRoot ?? 'docs');
    let overviewSourcePath: string | undefined;

    const indexCandidates = ['index.md', 'index.mdx', 'readme.md', 'README.md'];
    for (const cand of indexCandidates) {
      const p = path.join(docRootDir, cand);
      if (await this.checkFile(p)) {
        overviewSourcePath = p;
        break;
      }
    }

    if (!overviewSourcePath) {
      const rootReadmeCandidates = ['README.md', 'readme.md', 'Readme.md'];
      for (const cand of rootReadmeCandidates) {
        const p = path.join(repoCacheDir, cand);
        if (await this.checkFile(p)) {
          overviewSourcePath = p;
          break;
        }
      }
    }

    if (!overviewSourcePath) {
      return false;
    }

    const overviewDestDir = path.join(ctx.contentBaseDir, contentType, repo.id);
    await DocTransformer.processFile(overviewSourcePath, 'index.md', {
      repoId: repo.id,
      refName: defaultBranch,
      sourceDocRoot: path.dirname(overviewSourcePath),
      destDocDir: overviewDestDir,
      publicAssetDir: ctx.publicAssetDir,
      repoRemoteUrl: repo.remote,
      isProjectOverview: true,
      fallbackTitle: repo.name,
    });
    console.log(`[DocSync] Generated project overview for ${repo.name} at: ${overviewDestDir}`);
    return true;
  }

  private static async writeSidebarOutput(groups: ISidebarGroup[]): Promise<void> {
    const targetPath = path.resolve(process.cwd(), 'src/generated/sidebar.json');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, JSON.stringify(groups, null, 2), 'utf-8');
    console.log(`[DocSync] Generated sidebar saved to: ${targetPath}`);
  }

  private static async checkDir(dirPath: string): Promise<boolean> {
    try {
      const s = await fs.stat(dirPath);
      return s.isDirectory();
    } catch {
      return false;
    }
  }

  private static async checkFile(filePath: string): Promise<boolean> {
    try {
      const s = await fs.stat(filePath);
      return s.isFile();
    } catch {
      return false;
    }
  }
}

if (process.argv[1]?.endsWith('sync-docs.ts') || process.argv[1]?.endsWith('sync-docs.js')) {
  DocSyncEngine.run().catch((err) => {
    console.error('[DocSync] Fatal execution error:', err);
    process.exit(1);
  });
}
