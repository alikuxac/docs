import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RepoConfig } from './types.js';

export interface IChangelogContext {
  repo: RepoConfig;
  targetFilePath: string;
}

export interface IGitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
}

export const DEFAULT_MAX_CHANGELOG_ENTRIES = 30;
export const MAX_RELEASE_BODY_CHARS = 12000;

export class ChangelogPageGenerator {
  public static async generate(ctx: IChangelogContext): Promise<boolean> {
    const gitInfo = this.parseGitHubRepo(ctx.repo.remote);
    if (!gitInfo) {
      console.warn(`[Changelog] Remote URL '${ctx.repo.remote}' is not a GitHub repository, skipping changelog.`);
      return false;
    }

    const limit = ctx.repo.maxChangelogEntries ?? DEFAULT_MAX_CHANGELOG_ENTRIES;
    console.log(`[Changelog] Fetching up to ${limit} releases for ${gitInfo.owner}/${gitInfo.repo}...`);
    const releases = await this.fetchReleases(gitInfo.owner, gitInfo.repo, limit);

    if (releases.length === 0) {
      try {
        const stats = await fs.stat(ctx.targetFilePath);
        if (stats.size > 0) {
          console.warn(`[Changelog] Releases could not be fetched; preserving existing changelog at ${ctx.targetFilePath}`);
          return true;
        }
      } catch {
        // File does not exist, proceed to build fallback
      }
    }

    const markdown = this.buildMarkdown(ctx.repo, releases, limit);
    await fs.mkdir(path.dirname(ctx.targetFilePath), { recursive: true });
    await fs.writeFile(ctx.targetFilePath, markdown, 'utf-8');
    const writtenCount = Math.min(releases.length, limit);
    console.log(`[Changelog] Generated changelog for ${ctx.repo.id} (${writtenCount} releases) at ${ctx.targetFilePath}`);
    return true;
  }

  public static parseGitHubRepo(remoteUrl: string): { owner: string; repo: string } | null {
    const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  }

  public static async fetchReleases(
    owner: string,
    repo: string,
    limit: number = DEFAULT_MAX_CHANGELOG_ENTRIES
  ): Promise<IGitHubRelease[]> {
    const perPage = Math.min(Math.max(limit, 1), 100);
    const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=${perPage}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Alikuxac-Docs-Sync',
    };

    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        console.warn(`[Changelog] GitHub API error for ${owner}/${repo}: HTTP ${response.status} ${response.statusText}`);
        return [];
      }
      const data = (await response.json()) as IGitHubRelease[];
      if (!Array.isArray(data)) return [];
      return data.filter((release) => !release.draft);
    } catch (error: unknown) {
      console.warn(`[Changelog] Network error fetching releases for ${owner}/${repo}:`, error);
      return [];
    }
  }

  public static extractMcVersion(release: IGitHubRelease, knownVersions: string[] = []): string {
    const rawTag = release.tag_name || '';
    const rawName = release.name || '';

    const escapeRegex = (str: string): string =>
      str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const sortedVersions = [...knownVersions].sort((a, b) => b.length - a.length);

    for (const v of sortedVersions) {
      const vRegex = new RegExp(`(?<![0-9.])${escapeRegex(v)}(?![0-9.])`);
      if (vRegex.test(rawTag)) {
        return v;
      }
    }

    for (const v of sortedVersions) {
      const vRegex = new RegExp(`(?<![0-9.])${escapeRegex(v)}(?![0-9.])`);
      if (vRegex.test(rawName)) {
        return v;
      }
    }

    const combined = `${rawTag} ${rawName}`;
    const match = combined.match(/(?<![0-9.])(\d+(?:\.\d+)+(?:-[a-zA-Z0-9.]+)?)(?![0-9.])/);
    if (match) return match[1];

    return 'other';
  }

  public static buildMarkdown(
    repo: RepoConfig,
    releases: IGitHubRelease[],
    limit: number = DEFAULT_MAX_CHANGELOG_ENTRIES
  ): string {
    const category = repo.category ?? (repo.type === 'minecraft-mod' ? 'Minecraft Mods' : 'Projects');
    const topicId = category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const isMinecraftMod = repo.type === 'minecraft-mod';
    const knownVersions = isMinecraftMod && 'versions' in repo ? (repo.versions ?? []) : [];

    const lines: string[] = [
      '---',
      'title: Changelog',
      `description: Release history and version changelogs for ${repo.name}.`,
      `topic: ${topicId}`,
      'sidebar:',
      '  order: 2',
      'tableOfContents:',
      '  minHeadingLevel: 2',
      '  maxHeadingLevel: 2',
      '---',
      '',
      `Complete release history and version changelogs for **${repo.name}**:`,
      '',
    ];

    if (releases.length === 0) {
      const releasesWebUrl = repo.remote.replace(/\.git$/, '') + '/releases';
      lines.push(
        '> [!NOTE]',
        `> No published releases were retrieved from GitHub API at this time.`,
        `> You can check the [GitHub Releases page](${releasesWebUrl}) directly for current tags and updates.`,
        ''
      );
      return lines.join('\n');
    }

    const totalCount = releases.length;
    const hasMore = totalCount > limit;
    const targetReleases = hasMore ? releases.slice(0, limit) : releases;

    // Map releases with their Minecraft version
    const releasesWithMc = targetReleases.map((r) => ({
      release: r,
      mcVersion: this.extractMcVersion(r, knownVersions),
    }));

    // Collect all unique versions
    const versionCountMap = new Map<string, number>();
    for (const item of releasesWithMc) {
      versionCountMap.set(item.mcVersion, (versionCountMap.get(item.mcVersion) ?? 0) + 1);
    }

    // Ensure known versions from config are represented even if 0 releases yet
    for (const kv of knownVersions) {
      if (!versionCountMap.has(kv)) {
        versionCountMap.set(kv, 0);
      }
    }

    const availableVersions = Array.from(versionCountMap.keys()).sort((a, b) => {
      if (a === 'other') return 1;
      if (b === 'other') return -1;
      return b.localeCompare(a, undefined, { numeric: true });
    });

    // Render interactive version filter bar
    if (isMinecraftMod && availableVersions.length > 0) {
      lines.push('<div class="changelog-filter-container">');
      lines.push('  <div class="filter-header">');
      lines.push('    <span class="filter-label">');
      lines.push('      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"/></svg>');
      lines.push('      Minecraft Version:');
      lines.push('    </span>');
      lines.push(`    <span class="filter-status" id="changelog-status-text">Showing latest ${targetReleases.length} releases</span>`);
      lines.push('  </div>');
      lines.push('  <div class="filter-pills" role="tablist">');
      lines.push(`    <button type="button" class="version-pill active" data-version="all" role="tab" aria-selected="true">All Versions <span class="pill-count">${targetReleases.length}</span></button>`);

      for (const ver of availableVersions) {
        const count = versionCountMap.get(ver) ?? 0;
        const label = ver === 'other' ? 'Other' : `MC ${ver}`;
        lines.push(`    <button type="button" class="version-pill" data-version="${ver}" role="tab" aria-selected="false">${label} <span class="pill-count">${count}</span></button>`);
      }

      lines.push('  </div>');
      lines.push('</div>');
      lines.push('');
      lines.push('<div id="changelog-empty-message" class="changelog-empty-message" style="display: none;">');
      lines.push('  <p>No releases found for the selected Minecraft version.</p>');
      lines.push('</div>');
      lines.push('');
    }

    for (const item of releasesWithMc) {
      const { release, mcVersion } = item;
      const releaseTitle = release.name && release.name.trim().length > 0 ? release.name.trim() : release.tag_name;
      const dateStr = release.published_at
        ? new Date(release.published_at).toISOString().split('T')[0]
        : '';
      const badgeVariant = release.prerelease ? 'caution' : 'note';
      const badgeText = release.prerelease ? 'Pre-release' : 'Release';
      const mcBadge = mcVersion !== 'other' ? `<span class="badge tip">MC ${mcVersion}</span> ` : '';

      lines.push(`<section class="changelog-release-entry" data-mc-version="${mcVersion}">`);
      lines.push('');
      lines.push(`## ${releaseTitle}`);
      lines.push('');
      lines.push(
        `<span class="badge ${badgeVariant}">${badgeText}</span> ` +
          mcBadge +
          `\`${release.tag_name}\`${dateStr ? ` • *Published on ${dateStr}*` : ''} • [View on GitHub](${release.html_url})`
      );
      lines.push('');

      let cleanBody = release.body ? release.body.trim() : '';
      // Strip redundant leading version headers/titles that duplicate the release title
      cleanBody = cleanBody.replace(/^\s*#{0,6}\s*\[?v?\d+[^\]\n]*\]?\s*(?:\r?\n)+/, '');

      // Guard against giant bodies exceeding single file size thresholds
      if (cleanBody.length > MAX_RELEASE_BODY_CHARS) {
        cleanBody =
          cleanBody.slice(0, MAX_RELEASE_BODY_CHARS).trim() +
          `\n\n*... [Release notes truncated for file size limits. View complete notes on GitHub](${release.html_url})*`;
      }

      if (cleanBody.length > 0) {
        // Demote existing Markdown headers (h1-h4) by two levels so they nest under the release h2
        const formattedBody = cleanBody.replace(/^(#{1,4})\s+/gm, (_m, hashes) => '##' + hashes + ' ');
        lines.push(formattedBody.trim());
      } else {
        lines.push('*No detailed release notes provided for this build.*');
      }

      lines.push('');
      lines.push('---');
      lines.push('');
      lines.push('</section>');
      lines.push('');
    }

    if (hasMore) {
      const releasesWebUrl = repo.remote.replace(/\.git$/, '') + '/releases';
      lines.push(
        '> [!NOTE]',
        `> Showing the **${targetReleases.length}** most recent releases to maintain optimal page load performance.`,
        `> To browse older versions or full historical notes, visit the [GitHub Releases Archive](${releasesWebUrl}).`,
        ''
      );
    }

    // Inlined reactive filter script
    if (isMinecraftMod && availableVersions.length > 0) {
      lines.push('<script>');
      lines.push('  (() => {');
      lines.push('    const container = document.querySelector(".changelog-filter-container");');
      lines.push('    if (!container) return;');
      lines.push('    const pills = container.querySelectorAll(".version-pill");');
      lines.push('    const entries = document.querySelectorAll(".changelog-release-entry");');
      lines.push('    const statusText = document.getElementById("changelog-status-text");');
      lines.push('    const emptyMessage = document.getElementById("changelog-empty-message");');
      lines.push('    const totalCount = entries.length;');
      lines.push('');
      lines.push('    function setVersionFilter(targetVer) {');
      lines.push('      let matchedCount = 0;');
      lines.push('      pills.forEach((p) => {');
      lines.push('        const isActive = p.dataset.version === targetVer;');
      lines.push('        p.classList.toggle("active", isActive);');
      lines.push('        p.setAttribute("aria-selected", isActive ? "true" : "false");');
      lines.push('      });');
      lines.push('');
      lines.push('      entries.forEach((el) => {');
      lines.push('        const elVer = el.dataset.mcVersion;');
      lines.push('        const matches = targetVer === "all" || elVer === targetVer;');
      lines.push('        el.style.display = matches ? "" : "none";');
      lines.push('        if (matches) matchedCount++;');
      lines.push('      });');
      lines.push('');
      lines.push('      if (statusText) {');
      lines.push('        if (targetVer === "all") {');
      lines.push(`          statusText.textContent = \`${hasMore ? 'Showing latest' : 'Showing all'} \${totalCount} releases\`;`);
      lines.push('        } else {');
      lines.push('          statusText.textContent = `Showing ${matchedCount} release${matchedCount === 1 ? "" : "s"} for MC ${targetVer}`;');
      lines.push('        }');
      lines.push('      }');
      lines.push('');
      lines.push('      if (emptyMessage) {');
      lines.push('        emptyMessage.style.display = matchedCount === 0 ? "block" : "none";');
      lines.push('      }');
      lines.push('');
      lines.push('      const currentUrl = new URL(window.location.href);');
      lines.push('      if (targetVer === "all") {');
      lines.push('        currentUrl.searchParams.delete("mc");');
      lines.push('      } else {');
      lines.push('        currentUrl.searchParams.set("mc", targetVer);');
      lines.push('      }');
      lines.push('      window.history.replaceState(null, "", currentUrl.toString());');
      lines.push('    }');
      lines.push('');
      lines.push('    pills.forEach((btn) => {');
      lines.push('      btn.addEventListener("click", () => {');
      lines.push('        setVersionFilter(btn.dataset.version || "all");');
      lines.push('      });');
      lines.push('    });');
      lines.push('');
      lines.push('    const initialParam = new URLSearchParams(window.location.search).get("mc");');
      lines.push('    if (initialParam) {');
      lines.push('      const targetBtn = Array.from(pills).find((p) => p.dataset.version === initialParam);');
      lines.push('      if (targetBtn) setVersionFilter(initialParam);');
      lines.push('    }');
      lines.push('  })();');
      lines.push('</script>');
      lines.push('');
    }

    return lines.join('\n');
  }
}
