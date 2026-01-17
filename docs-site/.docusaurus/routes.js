import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/STELLA_backend/docs',
    component: ComponentCreator('/STELLA_backend/docs', 'f1b'),
    routes: [
      {
        path: '/STELLA_backend/docs',
        component: ComponentCreator('/STELLA_backend/docs', '444'),
        routes: [
          {
            path: '/STELLA_backend/docs',
            component: ComponentCreator('/STELLA_backend/docs', '625'),
            routes: [
              {
                path: '/STELLA_backend/docs',
                component: ComponentCreator('/STELLA_backend/docs', 'e69'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/agent-sdk/audio-pipeline',
                component: ComponentCreator('/STELLA_backend/docs/agent-sdk/audio-pipeline', '668'),
                exact: true
              },
              {
                path: '/STELLA_backend/docs/agent-sdk/base-agent',
                component: ComponentCreator('/STELLA_backend/docs/agent-sdk/base-agent', '496'),
                exact: true
              },
              {
                path: '/STELLA_backend/docs/agent-sdk/building-custom-agent',
                component: ComponentCreator('/STELLA_backend/docs/agent-sdk/building-custom-agent', 'acf'),
                exact: true
              },
              {
                path: '/STELLA_backend/docs/agent-sdk/getting-started',
                component: ComponentCreator('/STELLA_backend/docs/agent-sdk/getting-started', '468'),
                exact: true
              },
              {
                path: '/STELLA_backend/docs/agent-sdk/message-types',
                component: ComponentCreator('/STELLA_backend/docs/agent-sdk/message-types', '864'),
                exact: true
              },
              {
                path: '/STELLA_backend/docs/agent-sdk/overview',
                component: ComponentCreator('/STELLA_backend/docs/agent-sdk/overview', '4b6'),
                exact: true
              },
              {
                path: '/STELLA_backend/docs/agent-sdk/progress-tracking',
                component: ComponentCreator('/STELLA_backend/docs/agent-sdk/progress-tracking', '250'),
                exact: true
              },
              {
                path: '/STELLA_backend/docs/agent-sdk/tools',
                component: ComponentCreator('/STELLA_backend/docs/agent-sdk/tools', 'eb1'),
                exact: true
              },
              {
                path: '/STELLA_backend/docs/agents/echo-agent',
                component: ComponentCreator('/STELLA_backend/docs/agents/echo-agent', '760'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/agents/overview',
                component: ComponentCreator('/STELLA_backend/docs/agents/overview', '23c'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/agents/stella-agent',
                component: ComponentCreator('/STELLA_backend/docs/agents/stella-agent', 'f71'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/agents/stella-light-agent',
                component: ComponentCreator('/STELLA_backend/docs/agents/stella-light-agent', '987'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/architecture/data-flow',
                component: ComponentCreator('/STELLA_backend/docs/architecture/data-flow', '314'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/architecture/kubernetes-orchestration',
                component: ComponentCreator('/STELLA_backend/docs/architecture/kubernetes-orchestration', '181'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/architecture/overview',
                component: ComponentCreator('/STELLA_backend/docs/architecture/overview', 'c2d'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/architecture/session-lifecycle',
                component: ComponentCreator('/STELLA_backend/docs/architecture/session-lifecycle', 'ad9'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/contributing',
                component: ComponentCreator('/STELLA_backend/docs/contributing', '42e'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/contributing/coding-standards',
                component: ComponentCreator('/STELLA_backend/docs/contributing/coding-standards', '269'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/contributing/development-setup',
                component: ComponentCreator('/STELLA_backend/docs/contributing/development-setup', '7b7'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/contributing/pull-request-process',
                component: ComponentCreator('/STELLA_backend/docs/contributing/pull-request-process', '3fd'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/contributing/release-process',
                component: ComponentCreator('/STELLA_backend/docs/contributing/release-process', '6de'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/deployment/kubernetes',
                component: ComponentCreator('/STELLA_backend/docs/deployment/kubernetes', 'bb5'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/deployment/monitoring',
                component: ComponentCreator('/STELLA_backend/docs/deployment/monitoring', '8e1'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/deployment/nginx-setup',
                component: ComponentCreator('/STELLA_backend/docs/deployment/nginx-setup', '26a'),
                exact: true
              },
              {
                path: '/STELLA_backend/docs/deployment/production',
                component: ComponentCreator('/STELLA_backend/docs/deployment/production', '82d'),
                exact: true
              },
              {
                path: '/STELLA_backend/docs/deployment/production-checklist',
                component: ComponentCreator('/STELLA_backend/docs/deployment/production-checklist', '609'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/deployment/reverse-proxy',
                component: ComponentCreator('/STELLA_backend/docs/deployment/reverse-proxy', 'c53'),
                exact: true
              },
              {
                path: '/STELLA_backend/docs/getting-started/first-agent',
                component: ComponentCreator('/STELLA_backend/docs/getting-started/first-agent', '83e'),
                exact: true
              },
              {
                path: '/STELLA_backend/docs/getting-started/installation',
                component: ComponentCreator('/STELLA_backend/docs/getting-started/installation', 'fcc'),
                exact: true
              },
              {
                path: '/STELLA_backend/docs/getting-started/quick-start',
                component: ComponentCreator('/STELLA_backend/docs/getting-started/quick-start', 'e36'),
                exact: true
              },
              {
                path: '/STELLA_backend/docs/guides',
                component: ComponentCreator('/STELLA_backend/docs/guides', '405'),
                exact: true
              },
              {
                path: '/STELLA_backend/docs/guides/add-custom-ui',
                component: ComponentCreator('/STELLA_backend/docs/guides/add-custom-ui', 'de1'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/guides/create-your-own-agent',
                component: ComponentCreator('/STELLA_backend/docs/guides/create-your-own-agent', '96c'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/guides/getting-started',
                component: ComponentCreator('/STELLA_backend/docs/guides/getting-started', '3c8'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/integration/frontend',
                component: ComponentCreator('/STELLA_backend/docs/integration/frontend', 'a1f'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/integration/livekit',
                component: ComponentCreator('/STELLA_backend/docs/integration/livekit', '342'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/integration/livekit-production',
                component: ComponentCreator('/STELLA_backend/docs/integration/livekit-production', '1e0'),
                exact: true
              },
              {
                path: '/STELLA_backend/docs/sdk/base-agent',
                component: ComponentCreator('/STELLA_backend/docs/sdk/base-agent', '791'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/sdk/message-types',
                component: ComponentCreator('/STELLA_backend/docs/sdk/message-types', '6da'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/sdk/overview',
                component: ComponentCreator('/STELLA_backend/docs/sdk/overview', 'd45'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/sdk/streaming',
                component: ComponentCreator('/STELLA_backend/docs/sdk/streaming', 'fd6'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/sdk/tools',
                component: ComponentCreator('/STELLA_backend/docs/sdk/tools', '78b'),
                exact: true,
                sidebar: "docsSidebar"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    path: '/STELLA_backend/',
    component: ComponentCreator('/STELLA_backend/', '467'),
    exact: true
  },
  {
    path: '*',
    component: ComponentCreator('*'),
  },
];
