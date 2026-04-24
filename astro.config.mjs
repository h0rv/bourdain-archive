import { defineConfig } from 'astro/config';

const repository = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'bourdain-archive';
const owner = process.env.GITHUB_REPOSITORY_OWNER ?? 'h0rv';
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

const normalizeBase = (base) => {
  const normalized = `/${base.replace(/^\/+|\/+$/g, '')}`;
  return normalized === '/' ? '/' : normalized;
};

export default defineConfig({
  site: process.env.SITE ?? (isGitHubActions ? `https://${owner}.github.io` : 'http://localhost:4321'),
  base: normalizeBase(process.env.BASE_PATH ?? (isGitHubActions ? `/${repository}` : '/')),
  output: 'static',
  trailingSlash: 'always',
});
