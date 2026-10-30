import type { IDocsConfig } from './scripts/types.js';

export const docsConfig: IDocsConfig = {
  cacheDir: '.cache/doc-repos',
  targetContentDir: 'src/content/docs',
  publicAssetDir: 'public/docs-assets',
  repositories: [
    {
      id: 'machine-metrics',
      name: 'Machine Metrics',
      type: 'minecraft-mod',
      category: 'Minecraft Mods',
      remote: 'https://github.com/alikuxac/MachineMetrics.git',
      docRoot: 'docs',
      versions: ['1.21.1', '26.1.2'],
      tagStrategy: 'latest-tag',
      lifecycle: [
        {
          version: '26.1.2',
          status: 'active',
          loaders: ['NeoForge'],
          notes: 'In development',
        },
        {
          version: '1.21.1',
          status: 'active',
          loaders: ['NeoForge', 'Forge'],
          notes: 'Active development branch',
        },
      ],
    },
    {
      id: 'human-nature',
      name: 'Human Nature',
      type: 'minecraft-mod',
      category: 'Minecraft Mods',
      remote: 'https://github.com/alikuxac/HumanNature.git',
      docRoot: 'docs',
      versions: ['1.21.1'],
      tagStrategy: 'latest-tag',
      lifecycle: [
        {
          version: '1.21.1',
          status: 'active',
          loaders: ['NeoForge', "Forge"],
          notes: 'Active development branch',
        },
      ],
    },
    {
      id: 'alchemy-2048',
      name: 'Alchemy 2048',
      type: 'minecraft-mod',
      category: 'Minecraft Mods',
      remote: 'https://github.com/alikuxac/Alchemy2048.git',
      docRoot: 'docs',
      versions: ['1.21.1'],
      tagStrategy: 'latest-tag',
      lifecycle: [
        {
          version: '1.21.1',
          status: 'active',
          loaders: ['NeoForge', "Forge"],
          notes: 'Active development branch',
        },
      ],
    }
  ],
};

export default docsConfig;
