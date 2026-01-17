import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'doc',
      id: 'index',
      label: '🏠 Welcome',
    },
    {
      type: 'html',
      value: '<div class="sidebar-section-spacer"></div>',
    },
    {
      type: 'category',
      label: '🚀 Guides',
      collapsed: false,
      items: [
        'guides/getting-started',
        'guides/create-your-own-agent',
        'guides/add-custom-ui',
      ],
    },
    {
      type: 'html',
      value: '<div class="sidebar-section-spacer"></div>',
    },
    {
      type: 'category',
      label: '🏗️ Architecture',
      collapsed: false,
      items: [
        'architecture/overview',
        'architecture/data-flow',
        'architecture/session-lifecycle',
        'architecture/kubernetes-orchestration',
      ],
    },
    {
      type: 'html',
      value: '<div class="sidebar-section-spacer"></div>',
    },
    {
      type: 'category',
      label: '🤖 Agents',
      items: [
        'agents/overview',
        'agents/stella-agent',
        'agents/stella-light-agent',
        'agents/echo-agent',
      ],
    },
    {
      type: 'html',
      value: '<div class="sidebar-section-spacer"></div>',
    },
    {
      type: 'category',
      label: '📦 SDK Reference',
      items: [
        'sdk/overview',
        'sdk/base-agent',
        'sdk/message-types',
        'sdk/tools',
        'sdk/streaming',
      ],
    },
    {
      type: 'html',
      value: '<div class="sidebar-section-spacer"></div>',
    },
    {
      type: 'category',
      label: '🚢 Deployment',
      items: [
        'deployment/kubernetes',
        'deployment/production-checklist',
        'deployment/monitoring',
      ],
    },
    {
      type: 'html',
      value: '<div class="sidebar-section-spacer"></div>',
    },
    {
      type: 'category',
      label: '🔗 Integration',
      items: [
        'integration/livekit',
        'integration/frontend',
      ],
    },
    {
      type: 'html',
      value: '<div class="sidebar-section-spacer"></div>',
    },
    {
      type: 'category',
      label: '🤝 Contributing',
      items: [
        'contributing/index',
        'contributing/development-setup',
        'contributing/coding-standards',
        'contributing/pull-request-process',
        'contributing/release-process',
      ],
    },
  ],
};

export default sidebars;
