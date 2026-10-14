import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StarlightUserConfig } from '@astrojs/starlight/types';
import type { StarlightSidebarTopicsUserConfig } from 'starlight-sidebar-topics';

export type SidebarItem = NonNullable<StarlightUserConfig['sidebar']>[number];

export function loadGeneratedSidebar(): SidebarItem[] {
  try {
    const sidebarPath = path.resolve(process.cwd(), 'src/generated/sidebar.json');
    if (!fs.existsSync(sidebarPath)) {
      return [];
    }
    const rawContent = fs.readFileSync(sidebarPath, 'utf-8');
    const data = JSON.parse(rawContent);
    return Array.isArray(data) ? (data as SidebarItem[]) : [];
  } catch (error: unknown) {
    console.warn('[SidebarLoader] Unable to load generated sidebar:', error);
    return [];
  }
}

function findFirstLink(items: unknown[]): string | undefined {
  for (const item of items) {
    if (item && typeof item === 'object') {
      if ('link' in item && typeof item.link === 'string') {
        return item.link;
      }
      if ('items' in item && Array.isArray(item.items)) {
        const nested = findFirstLink(item.items);
        if (nested) return nested;
      }
    }
  }
  return undefined;
}

export function loadSidebarTopics(): StarlightSidebarTopicsUserConfig {
  const generated = loadGeneratedSidebar();

  const topics: StarlightSidebarTopicsUserConfig = [
    {
      id: 'overview',
      label: 'Overview',
      link: '/about/',
      icon: 'open-book',
      items: [
        {
          label: 'Introduction',
          link: '/about/',
        },
      ],
    },
  ];

  for (const group of generated) {
    if (group && typeof group === 'object' && 'label' in group && 'items' in group && Array.isArray(group.items)) {
      const labelStr = typeof group.label === 'string' ? group.label : 'Topic';
      const firstLink = findFirstLink(group.items) ?? '/about/';
      const id = labelStr.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const icon = id.includes('mod') ? 'puzzle' : 'document';
      const itemCount = group.items.length;

      topics.push({
        id,
        label: group.label,
        link: firstLink,
        icon,
        badge: {
          text: `${itemCount} ${itemCount === 1 ? 'Entry' : 'Entries'}`,
          variant: 'note',
        },
        items: group.items,
      });
    }
  }

  topics.push({
    label: 'Main Site',
    link: 'https://alikuxac.xyz',
    icon: 'external',
    attrs: { target: '_blank', rel: 'noopener noreferrer' },
  });

  return topics;
}
