import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { docsConfig } from '../docs.config.js';

const execFileAsync = promisify(execFile);

interface IRefHashMap {
  [repoId: string]: {
    [ref: string]: string;
  };
}

async function getRemoteHashes(remoteUrl: string, refs: string[]): Promise<Record<string, string>> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', remoteUrl, ...refs], {
      timeout: 10000,
    });

    const result: Record<string, string> = {};
    const lines = stdout.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [sha, refName] = trimmed.split(/\s+/);
      if (sha && refName) {
        result[refName] = sha;
      }
    }

    return result;
  } catch (error: unknown) {
    console.warn(`[CheckChanges] Warning: unable to ls-remote for ${remoteUrl}:`, error instanceof Error ? error.message : error);
    return {};
  }
}

export async function checkRemoteChanges(force: boolean = false): Promise<boolean> {
  const cacheFilePath = path.resolve(process.cwd(), '.cache/remote-hashes.json');
  let previousHashes: IRefHashMap = {};

  if (fs.existsSync(cacheFilePath)) {
    try {
      previousHashes = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8'));
    } catch {
      previousHashes = {};
    }
  }

  const currentHashes: IRefHashMap = {};
  let anyChanged = false;

  console.log('[CheckChanges] Probing remote repositories for updates...');

  for (const repo of docsConfig.repositories) {
    const refsToProbe: string[] = ['refs/tags/*'];

    if ('versions' in repo && Array.isArray(repo.versions)) {
      for (const v of repo.versions) {
        refsToProbe.push(`refs/heads/${v}`);
      }
    } else if ('branch' in repo && typeof repo.branch === 'string') {
      refsToProbe.push(`refs/heads/${repo.branch}`);
    } else {
      refsToProbe.push('HEAD');
    }

    const hashes = await getRemoteHashes(repo.remote, refsToProbe);
    currentHashes[repo.id] = hashes;

    const prevRepoHashes = previousHashes[repo.id] || {};
    const currentKeys = Object.keys(hashes);
    const prevKeys = Object.keys(prevRepoHashes);

    if (currentKeys.length !== prevKeys.length) {
      console.log(`[CheckChanges] Change detected in ${repo.id}: ref count changed (${prevKeys.length} -> ${currentKeys.length})`);
      anyChanged = true;
      continue;
    }

    for (const ref of currentKeys) {
      if (hashes[ref] !== prevRepoHashes[ref]) {
        console.log(`[CheckChanges] Change detected in ${repo.id} [${ref}]: ${prevRepoHashes[ref]?.slice(0, 7) ?? 'none'} -> ${hashes[ref].slice(0, 7)}`);
        anyChanged = true;
        break;
      }
    }
  }

  const hasChanges = force || anyChanged || Object.keys(previousHashes).length === 0;

  if (hasChanges) {
    fs.mkdirSync(path.dirname(cacheFilePath), { recursive: true });
    fs.writeFileSync(cacheFilePath, JSON.stringify(currentHashes, null, 2), 'utf-8');
    console.log(`[CheckChanges] Updated remote hashes cache at ${cacheFilePath}`);
  }

  return hasChanges;
}

async function main(): Promise<void> {
  const isForce = process.argv.includes('--force');
  const hasChanges = await checkRemoteChanges(isForce);

  console.log(`[CheckChanges] Result: has_changes=${hasChanges}`);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_changes=${hasChanges}\n`, 'utf-8');
  }

  if (!hasChanges) {
    console.log('[CheckChanges] All upstream repositories are identical. Zero work needed.');
  }
}

if (process.argv[1]?.endsWith('check-remote-changes.ts') || process.argv[1]?.endsWith('check-remote-changes.js')) {
  main().catch((err) => {
    console.error('[CheckChanges] Execution failed:', err);
    // On unexpected error, default to true so build doesn't get blocked
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, 'has_changes=true\n', 'utf-8');
    }
    process.exit(0);
  });
}
