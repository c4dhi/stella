import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'doc',
      id: 'index',
      label: 'Introduction',
    },
    {
      type: 'html',
      value: '<div class="sidebar-section-spacer"></div>',
    },
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/quick-start',
        'getting-started/installation',
        'getting-started/first-agent',
      ],
    },
    {
      type: 'html',
      value: '<div class="sidebar-section-spacer"></div>',
    },
    {
      type: 'category',
      label: 'Agents',
      collapsed: false,
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
      label: 'Agent SDK',
      collapsed: true,
      items: [
        'agent-sdk/overview',
        'agent-sdk/getting-started',
        'agent-sdk/base-agent',
        'agent-sdk/message-types',
        'agent-sdk/audio-pipeline',
        'agent-sdk/progress-tracking',
        'agent-sdk/tools',
        'agent-sdk/building-custom-agent',
      ],
    },
    {
      type: 'html',
      value: '<div class="sidebar-section-spacer"></div>',
    },
    {
      type: 'doc',
      id: 'guides',
      label: 'Guides',
    },
    {
      type: 'html',
      value: '<div class="sidebar-section-spacer"></div>',
    },
    {
      type: 'category',
      label: 'Deployment',
      collapsed: true,
      items: [
        'deployment/kubernetes',
        'deployment/production',
        'deployment/nginx-setup',
        'deployment/reverse-proxy',
      ],
    },
    {
      type: 'html',
      value: '<div class="sidebar-section-spacer"></div>',
    },
    {
      type: 'category',
      label: 'Integration',
      collapsed: true,
      items: [
        'integration/livekit',
        'integration/livekit-production',
      ],
    },
  ],
};

export default sidebars;
