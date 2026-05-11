import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://moxxy.dev',
  integrations: [
    starlight({
      title: 'moxxy',
      description: 'Block-based, modular agentic loop framework for TypeScript.',
      tagline: 'Block-based agentic loop framework.',
      social: {
        github: 'https://github.com/your-org/moxxy',
      },
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { label: 'Introduction', slug: 'index' },
            { label: 'Quickstart', slug: 'quickstart' },
            { label: 'Architecture', slug: 'architecture' },
          ],
        },
        {
          label: 'Guides',
          autogenerate: { directory: 'guides' },
        },
        {
          label: 'Packages',
          autogenerate: { directory: 'packages' },
        },
      ],
      customCss: [],
    }),
  ],
});
