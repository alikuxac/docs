export type RepoType = 'minecraft-mod' | 'standard';

export type SupportStatus = 'active' | 'maintenance' | 'eos';

export interface IVersionLifecycle {
  version: string;
  status: SupportStatus;
  loaders?: string[];
  releaseTag?: string;
  notes?: string;
}

export interface IBaseRepoConfig {
  id: string;
  name: string;
  remote: string;
  docRoot?: string;
  category?: string;
  lifecycle?: IVersionLifecycle[];
}

export interface IMinecraftModRepoConfig extends IBaseRepoConfig {
  type: 'minecraft-mod';
  versions: string[];
  versionBranchPattern?: string;
  tagStrategy?: 'branch-head' | 'latest-tag';
}

export interface IStandardBranchDef {
  branch: string;
  displayName: string;
  subPath?: string;
}

export interface IStandardRepoConfig extends IBaseRepoConfig {
  type: 'standard';
  branches: {
    stable: IStandardBranchDef;
    development?: IStandardBranchDef;
  };
}

export type RepoConfig = IMinecraftModRepoConfig | IStandardRepoConfig;

export interface IDocsConfig {
  cacheDir?: string;
  targetContentDir?: string;
  publicAssetDir?: string;
  repositories: RepoConfig[];
}

export interface IGitFetchResult {
  repoId: string;
  refName: string;
  extractedPath: string;
  versionLabel: string;
  targetSlug: string;
  sourceUrl: string;
}

export interface ISidebarAutogenerate {
  autogenerate: {
    directory: string;
    collapsed?: boolean;
  };
}

export interface ISidebarItem {
  label?: string;
  slug?: string;
  link?: string;
  badge?: {
    text: string;
    variant?: 'note' | 'tip' | 'danger' | 'caution' | 'success' | 'default';
  };
  items?: Array<ISidebarItem | ISidebarAutogenerate>;
  collapsed?: boolean;
}

export interface ISidebarGroup {
  label: string;
  items: ISidebarItem[];
}
