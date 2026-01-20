import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/STELLA_backend/docs',
    component: ComponentCreator('/STELLA_backend/docs', '58f'),
    routes: [
      {
        path: '/STELLA_backend/docs',
        component: ComponentCreator('/STELLA_backend/docs', '97d'),
        routes: [
          {
            path: '/STELLA_backend/docs',
            component: ComponentCreator('/STELLA_backend/docs', 'c0f'),
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
                component: ComponentCreator('/STELLA_backend/docs/agents/stella-agent', '12e'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/agents/stella-agent/configuration',
                component: ComponentCreator('/STELLA_backend/docs/agents/stella-agent/configuration', '5ee'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/agents/stella-agent/custom-experts',
                component: ComponentCreator('/STELLA_backend/docs/agents/stella-agent/custom-experts', '55b'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/agents/stella-agent/default-experts',
                component: ComponentCreator('/STELLA_backend/docs/agents/stella-agent/default-experts', '918'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/agents/stella-agent/expert-pool-overview',
                component: ComponentCreator('/STELLA_backend/docs/agents/stella-agent/expert-pool-overview', 'f6f'),
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
                path: '/STELLA_backend/docs/architecture/database',
                component: ComponentCreator('/STELLA_backend/docs/architecture/database', '93b'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/architecture/environment-variables',
                component: ComponentCreator('/STELLA_backend/docs/architecture/environment-variables', '1c3'),
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
                path: '/STELLA_backend/docs/changelog',
                component: ComponentCreator('/STELLA_backend/docs/changelog', 'f02'),
                exact: true
              },
              {
                path: '/STELLA_backend/docs/contributing',
                component: ComponentCreator('/STELLA_backend/docs/contributing', '42e'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/contributing/coding-standards',
                component: ComponentCreator('/STELLA_backend/docs/contributing/coding-standards', 'c67'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/contributing/coding-standards/git',
                component: ComponentCreator('/STELLA_backend/docs/contributing/coding-standards/git', '081'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/contributing/coding-standards/python',
                component: ComponentCreator('/STELLA_backend/docs/contributing/coding-standards/python', '08e'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/contributing/coding-standards/react',
                component: ComponentCreator('/STELLA_backend/docs/contributing/coding-standards/react', '78c'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/contributing/coding-standards/testing',
                component: ComponentCreator('/STELLA_backend/docs/contributing/coding-standards/testing', '6cd'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/contributing/coding-standards/typescript',
                component: ComponentCreator('/STELLA_backend/docs/contributing/coding-standards/typescript', 'cb7'),
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
                path: '/STELLA_backend/docs/deployment/message-recording',
                component: ComponentCreator('/STELLA_backend/docs/deployment/message-recording', '16f'),
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
                component: ComponentCreator('/STELLA_backend/docs/deployment/nginx-setup', 'a5f'),
                exact: true,
                sidebar: "docsSidebar"
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
                path: '/STELLA_backend/docs/guides/authentication',
                component: ComponentCreator('/STELLA_backend/docs/guides/authentication', '298'),
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
                path: '/STELLA_backend/docs/guides/custom-tools',
                component: ComponentCreator('/STELLA_backend/docs/guides/custom-tools', 'd3d'),
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
                component: ComponentCreator('/STELLA_backend/docs/integration/livekit-production', '369'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/plan-structure',
                component: ComponentCreator('/STELLA_backend/docs/plan-structure', '6a7'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/plan-structure/deliverables',
                component: ComponentCreator('/STELLA_backend/docs/plan-structure/deliverables', 'a17'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/plan-structure/examples',
                component: ComponentCreator('/STELLA_backend/docs/plan-structure/examples', '6ec'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/plan-structure/states',
                component: ComponentCreator('/STELLA_backend/docs/plan-structure/states', '932'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/plan-structure/tasks',
                component: ComponentCreator('/STELLA_backend/docs/plan-structure/tasks', '2d4'),
                exact: true,
                sidebar: "docsSidebar"
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
              },
              {
                path: '/STELLA_backend/docs/sdk/typescript-types',
                component: ComponentCreator('/STELLA_backend/docs/sdk/typescript-types', '10a'),
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
