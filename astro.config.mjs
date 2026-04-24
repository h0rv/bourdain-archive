import { defineConfig } from 'astro/config';

const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];
const owner = process.env.GITHUB_REPOSITORY_OWNER;
const isGitHubPages = process.env.GITHUB_ACTIONS === 'true' && repository && owner;

export default defineConfig({
  site: process.env.SITE ?? (owner ? `https://${owner}.github.io` : 'http://localhost:4321'),
  base: isGitHubPages ? `/${repository}` : '/',
  output: 'static',
  trailingSlash: 'always',
});
