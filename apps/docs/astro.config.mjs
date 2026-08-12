import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.moxxy.ai',
  integrations: [
    starlight({
      title: 'moxxy',
      description: 'A local AI agent for developers: simple to start, extensible when needed, ready to govern.',
      tagline: 'Your local agent. Simple to start. Ready to govern.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/moxxy-ai/moxxy',
        },
      ],
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { label: 'Introduction', slug: 'index' },
            { label: 'Quickstart', slug: 'quickstart' },
            { label: 'Developer alpha', slug: 'developer-alpha' },
            { label: 'Why moxxy', slug: 'why-moxxy' },
          ],
        },
        {
          label: 'Extend',
          items: [
            { label: 'Author a skill', slug: 'guides/authoring-a-skill' },
            { label: 'Author an extension', slug: 'guides/authoring-a-plugin' },
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
          items: [{ autogenerate: { directory: 'guides' } }],
        },
        {
          label: 'Packages',
          items: [{ autogenerate: { directory: 'packages' } }],
        },
      ],
    }),
  ],
});
