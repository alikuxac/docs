import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { IVersionLifecycle, RepoConfig, SupportStatus } from './types.js';

export interface ILifecycleContext {
  repo: RepoConfig;
  targetFilePath: string;
  resolvedTags: Map<string, string>;
  docLinks: Map<string, string>;
}

export class LifecyclePageGenerator {
  public static async generate(ctx: ILifecycleContext): Promise<void> {
    if (!ctx.repo.lifecycle || ctx.repo.lifecycle.length === 0) return;

    const content = this.buildMarkdown(ctx);
    await fs.mkdir(path.dirname(ctx.targetFilePath), { recursive: true });
    await fs.writeFile(ctx.targetFilePath, content, 'utf-8');
  }

  private static buildMarkdown(ctx: ILifecycleContext): string {
    const rows = ctx.repo.lifecycle!.map((item) => this.buildRow(item, ctx));
    const isMinecraftMod = ctx.repo.type === 'minecraft-mod';
    const versionHeader = isMinecraftMod ? 'Minecraft Version' : 'Project Version';
    const loadersHeader = isMinecraftMod ? 'Mod Loaders | ' : '';

    const category = ctx.repo.category ?? (isMinecraftMod ? 'Minecraft Mods' : 'Projects');
    const topicId = category.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    return [
      '---',
      `title: Version Support & Lifecycle`,
      `description: Version support matrix, release lifecycle, and compatibility for ${ctx.repo.name}.`,
      `topic: ${topicId}`,
      '---',
      '',
      `Maintenance and compatibility status for **${ctx.repo.name}**:`,
      '',
      `| ${versionHeader} | Latest Release | Status | ${loadersHeader}Docs | Notes |`,
      `| :--- | :--- | :--- | ${isMinecraftMod ? ':--- | ' : ''}:--- | :--- |`,
      ...rows,
      '',
      '> [!NOTE]',
      '> - **Active (🟢)**: Actively maintained with new feature updates and bug fixes.',
      '> - **Maintenance (🟡)**: Limited support for critical or game-breaking bug fixes only.',
      '> - **EOS (🔴)**: End of Support. No further updates or patches will be released.',
      `>`,
      `> For full release notes and version history, see the [Changelog](${isMinecraftMod ? `/mods/${ctx.repo.id}/changelog/` : `/projects/${ctx.repo.id}/changelog/`}).`,
      '',
    ].join('\n');
  }

  private static buildRow(item: IVersionLifecycle, ctx: ILifecycleContext): string {
    const latestTag = ctx.resolvedTags.get(item.version) ?? item.releaseTag ?? '—';
    const statusBadge = this.formatStatus(item.status);
    const docLink = ctx.docLinks.get(item.version);
    const docCell = docLink ? `[View Docs](${docLink})` : '—';
    const notesCell = item.notes ?? '—';

    if (ctx.repo.type === 'minecraft-mod') {
      const loadersCell = item.loaders && item.loaders.length > 0 ? item.loaders.join(', ') : '—';
      return `| **${item.version}** | \`${latestTag}\` | ${statusBadge} | ${loadersCell} | ${docCell} | ${notesCell} |`;
    }

    return `| **${item.version}** | \`${latestTag}\` | ${statusBadge} | ${docCell} | ${notesCell} |`;
  }

  private static formatStatus(status: SupportStatus): string {
    switch (status) {
      case 'active':
        return '🟢 **Active**';
      case 'maintenance':
        return '🟡 **Maintenance**';
      case 'eos':
        return '🔴 **EOS**';
      default:
        return status;
    }
  }
}
