import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'STELLA',
  tagline: 'System for Testing and Engineering LLM-based Conversational Agents',
  favicon: 'img/favicon.ico',

  // GitHub Pages configuration
  url: 'https://c4dhi.github.io',
  baseUrl: '/STELLA_backend/',
  organizationName: 'c4dhi',
  projectName: 'STELLA_backend',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: 'docs', // Serve docs at /docs/
          editUrl: 'https://github.com/c4dhi/STELLA_backend/tree/main/docs-site/',
        },
        blog: false, // Disable blog
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/stella-social-card.png',
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'STELLA',
      logo: {
        alt: 'STELLA Logo',
        src: 'img/stella-logo.svg',
        srcDark: 'img/stella-logo-dark.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/c4dhi/STELLA_backend',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/getting-started/quick-start',
            },
            {
              label: 'Agents',
              to: '/docs/agents/overview',
            },
            {
              label: 'Agent SDK',
              to: '/docs/agent-sdk/overview',
            },
          ],
        },
        {
          title: 'Deployment',
          items: [
            {
              label: 'Kubernetes',
              to: '/docs/deployment/kubernetes',
            },
            {
              label: 'Production',
              to: '/docs/deployment/production',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/c4dhi/STELLA_backend',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} STELLA Project. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'yaml', 'json', 'typescript', 'python', 'nginx'],
    },
    tableOfContents: {
      minHeadingLevel: 2,
      maxHeadingLevel: 4,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
