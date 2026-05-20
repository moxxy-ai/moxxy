import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.moxxy.ai',
  integrations: [
    starlight({
      title: 'moxxy',
      description: 'Block-based, modular agentic loop framework for TypeScript.',
      tagline: 'Block-based agentic loop framework.',
      social: {
        github: 'https://github.com/moxxy-ai/new_moxxy',
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
          label: 'Channels',
          items: [
            { label: 'Telegram channel', slug: 'guides/telegram-channel' },
            { label: 'HTTP channel', slug: 'guides/http-channel' },
            { label: 'Running as a service', slug: 'guides/running-as-a-service' },
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
