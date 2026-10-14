import { docsConfig } from '../docs.config.js';

interface IDispatchPayload {
  owner: string;
  repo: string;
  targetRepoId?: string;
  ref?: string;
  token: string;
}

export async function dispatchDocsSync(payload: IDispatchPayload): Promise<void> {
  const url = `https://api.github.com/repos/${payload.owner}/${payload.repo}/dispatches`;

  const body = {
    event_type: 'sync-docs',
    client_payload: {
      repo: payload.targetRepoId ?? '',
      ref: payload.ref ?? 'manual',
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${payload.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (response.status === 204) {
    console.log(`[Dispatch] Successfully triggered 'sync-docs' on ${payload.owner}/${payload.repo}`);
    if (payload.targetRepoId) {
      console.log(`[Dispatch] Target repository: ${payload.targetRepoId}`);
    }
  } else {
    const text = await response.text();
    throw new Error(`Dispatch failed (${response.status}): ${text}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const repoFlagIndex = args.indexOf('--repo');
  const targetRepoId = repoFlagIndex !== -1 ? args[repoFlagIndex + 1] : undefined;

  const token = process.env.GITHUB_TOKEN || process.env.DOCS_PORTAL_TOKEN;
  if (!token) {
    console.error('Error: GITHUB_TOKEN or DOCS_PORTAL_TOKEN environment variable required.');
    process.exit(1);
  }

  if (targetRepoId) {
    const validRepo = docsConfig.repositories.find((r) => r.id === targetRepoId);
    if (!validRepo) {
      console.error(
        `Error: Repository '${targetRepoId}' is not defined in docs.config.ts. Available: ${docsConfig.repositories.map((r) => r.id).join(', ')}`
      );
      process.exit(1);
    }
  }

  const docsRepoSlug = process.env.DOCS_PORTAL_REPO || 'alikuxac/docs';
  const [owner, repo] = docsRepoSlug.split('/');

  if (!owner || !repo) {
    console.error("Error: Invalid DOCS_PORTAL_REPO format. Expected 'owner/repo'.");
    process.exit(1);
  }

  try {
    await dispatchDocsSync({
      owner,
      repo,
      targetRepoId,
      token,
    });
  } catch (error: unknown) {
    console.error('[Dispatch] Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('trigger-dispatch.ts') || process.argv[1]?.endsWith('trigger-dispatch.js')) {
  main();
}
