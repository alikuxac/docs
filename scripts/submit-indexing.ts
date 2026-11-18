import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface IIndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

const DEFAULT_KEY = 'ede67f79b11b18ae6ca11e5b180ed823';
const HOST = 'docs.alikuxac.xyz';
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isSubmitAll = args.includes('--all') || args.includes('--force');

  const key = process.env.INDEXNOW_KEY || DEFAULT_KEY;
  const keyLocation = `https://${HOST}/${key}.txt`;

  console.log('[IndexNow] Starting search engine indexing submission...');
  console.log(`[IndexNow] Host: ${HOST} | Key: ${key.slice(0, 6)}...${key.slice(-4)}`);

  const cacheDir = path.resolve(process.cwd(), '.cache');
  const changedUrlsFile = path.join(cacheDir, 'changed-urls.json');
  const metadataFile = path.join(cacheDir, 'sitemap-metadata.json');

  let urlsToSubmit: string[] = [];

  if (isSubmitAll) {
    console.log('[IndexNow] Mode: --all / --force (collecting all known documentation URLs)');
    try {
      const raw = await fs.readFile(metadataFile, 'utf-8');
      const metadata = JSON.parse(raw);
      urlsToSubmit = Object.keys(metadata);
    } catch {
      console.warn('[IndexNow] Warning: Could not read sitemap-metadata.json, defaulting to root URL.');
      urlsToSubmit = [`https://${HOST}/`];
    }
  } else {
    try {
      const raw = await fs.readFile(changedUrlsFile, 'utf-8');
      urlsToSubmit = JSON.parse(raw);
    } catch {
      console.warn('[IndexNow] Notice: changed-urls.json not found.');
    }
  }

  if (urlsToSubmit.length === 0) {
    console.log('[IndexNow] No changed URLs detected in this build. Nothing to submit.');
    return;
  }

  urlsToSubmit = Array.from(new Set(urlsToSubmit.filter((u) => u.startsWith(`https://${HOST}`))));

  const batch = urlsToSubmit.slice(0, 10000);

  const payload: IIndexNowPayload = {
    host: HOST,
    key,
    keyLocation,
    urlList: batch,
  };

  console.log(`[IndexNow] Preparing to submit ${batch.length} URLs to search engines via IndexNow:`);
  batch.slice(0, 10).forEach((u) => console.log(`  - ${u}`));
  if (batch.length > 10) {
    console.log(`  ... and ${batch.length - 10} more URLs`);
  }

  if (isDryRun) {
    console.log('[IndexNow] Dry-run enabled. Skipping network request. Payload preview:');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 200) {
      console.log(`[IndexNow] Success: 200 OK - Search engines acknowledged URL submissions.`);
    } else if (response.status === 202) {
      console.log(
        `[IndexNow] Accepted: 202 - IndexNow key is being validated or URLs queued for indexing.`
      );
    } else {
      const text = await response.text();
      console.warn(
        `[IndexNow] Warning: Received HTTP ${response.status} ${response.statusText} from api.indexnow.org:`,
        text
      );
    }
  } catch (error: unknown) {
    console.error(
      '[IndexNow] Error submitting to IndexNow endpoint:',
      error instanceof Error ? error.message : error
    );
  }
}

main().catch((err) => {
  console.error('[IndexNow] Unexpected error:', err);
  process.exit(1);
});

