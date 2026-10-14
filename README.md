# Alikuxac Docs Portal

The central documentation portal for Alikuxac's Minecraft mods and developer tools, hosted at [docs.alikuxac.xyz](https://docs.alikuxac.xyz).

This repository runs an automated ingestion pipeline that pulls markdown files and version tags directly from external project repositories during build time. The build runs statelessly on GitHub Actions and deploys to Cloudflare Pages with zero automated Git commits.

## Architecture

1. **Upstream Ingestion (`scripts/sync-docs.ts`)**: Reads `docs.config.ts`, runs sparse Git checkouts on configured branches and release tags, extracts `docs/` folders, and generates `src/generated/sidebar.json`.
2. **Stateless Build**: Synced docs (`src/content/docs/mods/`), generated sidebars, and assets are ignored by Git. Builds compile to `dist/` on ephemeral runners and deploy directly to Cloudflare Pages.
3. **Change Detection Gate (`scripts/check-remote-changes.ts`)**: A 12-hour cron checks remote commit hashes via `git ls-remote`. If no upstream commits or tags changed, the workflow exits in 3 seconds without building.

## Development

Install dependencies:

```bash
pnpm install
```

Sync documentation from configured repositories:

```bash
# Sync all configured repositories
pnpm docs:sync

# Or sync a single repository
pnpm docs:sync --repo machine-metrics

# Clean cache before syncing
pnpm docs:sync --clean
```

Start the local development server:

```bash
pnpm dev
```

Build and validate the production bundle:

```bash
pnpm build
```

Preview the production build locally (required to test Pagefind search locally):

```bash
pnpm preview
```

Deploy directly to Cloudflare Pages:

```bash
pnpm deploy:cf
```

## Adding a Repository

Add a new repository entry to `docs.config.ts`:

```typescript
{
  id: 'my-mod',
  name: 'My Mod',
  type: 'minecraft-mod',
  category: 'Minecraft Mods',
  remote: 'https://github.com/alikuxac/MyMod.git',
  docRoot: 'docs',
  versions: ['1.21.1'],
  tagStrategy: 'latest-tag',
  lifecycle: [
    {
      version: '1.21.1',
      status: 'active',
      loaders: ['NeoForge', 'Forge'],
      notes: 'Active development branch',
    },
  ],
}
```

Run `pnpm docs:sync` to verify the checkout and generated sidebar entries.

## Upstream Webhook Setup

Upstream repositories can trigger rebuilds on push or release tags by sending a `repository_dispatch` event to this repository. See [.github/notify-docs-portal.example.yml](.github/notify-docs-portal.example.yml) for the workflow template.
