// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';
import sitemap from '@astrojs/sitemap';
import starlightSidebarTopics from 'starlight-sidebar-topics';
import starlightLinksValidator from 'starlight-links-validator';
import starlightImageZoom from 'starlight-image-zoom';
import starlightLlmsTxt from 'starlight-llms-txt';
import { unified } from '@astrojs/markdown-remark';
import { remarkAlert } from 'remark-github-blockquote-alert';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import fg from 'fast-glob';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { loadSidebarTopics } from './src/utils/sidebar-loader.ts';

const isLinksValidationEnabled = process.env.CHECK_LINKS !== 'false';

/**
 * Cloudflare Rocket Loader rewrites `<script type="module">` into `<script type="<hash>-module">`,
 * breaking dynamic ES module imports such as Starlight Pagefind Search and Web Components on custom domains.
 * Adding `data-cfasync="false"` instructs Cloudflare to leave the scripts untouched.
 *
 * @returns {import('astro').AstroIntegration}
 */
function disableCloudflareRocketLoader() {
	return {
		name: 'disable-cloudflare-rocket-loader',
		hooks: {
			/** @param {{ dir: URL }} options */
			'astro:build:done': async ({ dir }) => {
				const outDir = fileURLToPath(dir);
				const htmlFiles = await fg('**/*.html', { cwd: outDir, absolute: true });
				for (const file of htmlFiles) {
					const content = await fs.readFile(file, 'utf-8');
					const updated = content.replace(/<script\b(?![^>]*\bdata-cfasync=)/gi, '<script data-cfasync="false"');
					if (updated !== content) {
						await fs.writeFile(file, updated, 'utf-8');
					}
				}
			},
		},
	};
}

// https://astro.build/config
export default defineConfig({
	site: 'https://docs.alikuxac.xyz',
	markdown: {
		processor: unified({
			remarkPlugins: [remarkAlert, remarkMath],
			rehypePlugins: [rehypeKatex],
		}),
	},
	vite: {
		build: {
			chunkSizeWarningLimit: 1500,
			rollupOptions: {
				output: {
					manualChunks(id) {
						if (id.includes('node_modules/mermaid')) return 'mermaid-vendor';
					},
				},
			},
		},
	},
	integrations: [
		mermaid({
			theme: 'neutral',
			autoTheme: true,
			enableLog: false,
			mermaidConfig: {
				fontFamily: 'var(--sl-font)',
				flowchart: {
					curve: 'basis',
					htmlLabels: true,
					useMaxWidth: false,
				},
				sequence: {
					mirrorActors: false,
					useMaxWidth: false,
				},
				class: {
					useMaxWidth: false,
				},
				state: {
					useMaxWidth: false,
				},
				er: {
					useMaxWidth: false,
				},
			},
		}),
		starlight({
			title: 'Alikuxac Docs',
			description: 'Centralized documentation and configuration guides for Minecraft mods and developer projects.',
			customCss: [
				'./src/styles/custom.css',
				'remark-github-blockquote-alert/alert.css',
				'katex/dist/katex.min.css',
			],
			components: {
				ThemeProvider: './src/components/ThemeProvider.astro',
				ThemeSelect: './src/components/ThemeSelect.astro',
				Pagination: './src/components/Pagination.astro',
				Sidebar: './src/components/Sidebar.astro',
			},
			social: [
				{ icon: 'external', label: 'alikuxac.xyz', href: 'https://alikuxac.xyz' },
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/alikuxac' },
			],
			plugins: [
				starlightSidebarTopics(loadSidebarTopics(), {
					exclude: ['/'],
				}),
				starlightImageZoom({
					showCaptions: true,
				}),
				...(isLinksValidationEnabled
					? [
							starlightLinksValidator({
								errorOnInvalidHashes: true,
								errorOnRelativeLinks: false,
								failOnError: true,
							}),
						]
					: []),
				starlightLlmsTxt({
					projectName: 'Alikuxac Documentation Portal',
					description: 'Centralized documentation, version matrix, and configuration references for Minecraft mods and developer tools.',
					details: `
Key Portal Specifications:
- Mod configs are documented across versions (e.g. 1.21.1) and loaders (NeoForge, Forge, Fabric).
- Synchronized with active Git repositories and release tags.
					`.trim(),
					promote: ['about*', 'mods/**/index*', 'mods/**/configuration*', 'mods/**/versions*'],
					customSets: [
						{
							label: 'Core Overview & Guidelines',
							paths: ['about*', 'index*'],
							description: 'General project overview and getting started guides',
						},
					],
					exclude: ['404*', '_llms-txt/**'],
				}),
			],
		}),
		sitemap({
			filter: (page) => !page.includes('/404') && !page.includes('/_llms-txt'),
			changefreq: 'weekly',
			priority: 0.7,
			lastmod: new Date(),
		}),
		disableCloudflareRocketLoader(),
	],
}
);
