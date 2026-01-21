import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/STELLA_Documentation/__docusaurus/debug',
    component: ComponentCreator('/STELLA_Documentation/__docusaurus/debug', '06e'),
    exact: true
  },
  {
    path: '/STELLA_Documentation/__docusaurus/debug/config',
    component: ComponentCreator('/STELLA_Documentation/__docusaurus/debug/config', 'a4b'),
    exact: true
  },
  {
    path: '/STELLA_Documentation/__docusaurus/debug/content',
    component: ComponentCreator('/STELLA_Documentation/__docusaurus/debug/content', 'ccd'),
    exact: true
  },
  {
    path: '/STELLA_Documentation/__docusaurus/debug/globalData',
    component: ComponentCreator('/STELLA_Documentation/__docusaurus/debug/globalData', 'b71'),
    exact: true
  },
  {
    path: '/STELLA_Documentation/__docusaurus/debug/metadata',
    component: ComponentCreator('/STELLA_Documentation/__docusaurus/debug/metadata', 'b77'),
    exact: true
  },
  {
    path: '/STELLA_Documentation/__docusaurus/debug/registry',
    component: ComponentCreator('/STELLA_Documentation/__docusaurus/debug/registry', '307'),
    exact: true
  },
  {
    path: '/STELLA_Documentation/__docusaurus/debug/routes',
    component: ComponentCreator('/STELLA_Documentation/__docusaurus/debug/routes', '155'),
    exact: true
  },
  {
    path: '/STELLA_Documentation/docs',
    component: ComponentCreator('/STELLA_Documentation/docs', '467'),
    routes: [
      {
        path: '/STELLA_Documentation/docs',
        component: ComponentCreator('/STELLA_Documentation/docs', '7bb'),
        routes: [
          {
            path: '/STELLA_Documentation/docs',
            component: ComponentCreator('/STELLA_Documentation/docs', 'c16'),
            routes: [
              {
                path: '/STELLA_Documentation/docs',
                component: ComponentCreator('/STELLA_Documentation/docs', 'f07'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/agent-sdk/audio-pipeline',
                component: ComponentCreator('/STELLA_Documentation/docs/agent-sdk/audio-pipeline', '4c3'),
                exact: true
              },
              {
                path: '/STELLA_Documentation/docs/agent-sdk/base-agent',
                component: ComponentCreator('/STELLA_Documentation/docs/agent-sdk/base-agent', '722'),
                exact: true
              },
              {
                path: '/STELLA_Documentation/docs/agent-sdk/building-custom-agent',
                component: ComponentCreator('/STELLA_Documentation/docs/agent-sdk/building-custom-agent', '2c4'),
                exact: true
              },
              {
                path: '/STELLA_Documentation/docs/agent-sdk/getting-started',
                component: ComponentCreator('/STELLA_Documentation/docs/agent-sdk/getting-started', 'a2d'),
                exact: true
              },
              {
                path: '/STELLA_Documentation/docs/agent-sdk/message-types',
                component: ComponentCreator('/STELLA_Documentation/docs/agent-sdk/message-types', 'a6c'),
                exact: true
              },
              {
                path: '/STELLA_Documentation/docs/agent-sdk/overview',
                component: ComponentCreator('/STELLA_Documentation/docs/agent-sdk/overview', '6e5'),
                exact: true
              },
              {
                path: '/STELLA_Documentation/docs/agent-sdk/progress-tracking',
                component: ComponentCreator('/STELLA_Documentation/docs/agent-sdk/progress-tracking', 'd00'),
                exact: true
              },
              {
                path: '/STELLA_Documentation/docs/agent-sdk/tools',
                component: ComponentCreator('/STELLA_Documentation/docs/agent-sdk/tools', 'e15'),
                exact: true
              },
              {
                path: '/STELLA_Documentation/docs/agents/echo-agent',
                component: ComponentCreator('/STELLA_Documentation/docs/agents/echo-agent', '9a4'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/agents/overview',
                component: ComponentCreator('/STELLA_Documentation/docs/agents/overview', '148'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/agents/stella-agent',
                component: ComponentCreator('/STELLA_Documentation/docs/agents/stella-agent', 'e54'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/agents/stella-agent/configuration',
                component: ComponentCreator('/STELLA_Documentation/docs/agents/stella-agent/configuration', '4e8'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/agents/stella-agent/custom-experts',
                component: ComponentCreator('/STELLA_Documentation/docs/agents/stella-agent/custom-experts', 'e7d'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/agents/stella-agent/default-experts',
                component: ComponentCreator('/STELLA_Documentation/docs/agents/stella-agent/default-experts', 'd50'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/agents/stella-agent/expert-pool-overview',
                component: ComponentCreator('/STELLA_Documentation/docs/agents/stella-agent/expert-pool-overview', '014'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/agents/stella-light-agent',
                component: ComponentCreator('/STELLA_Documentation/docs/agents/stella-light-agent', 'a7f'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/architecture/data-flow',
                component: ComponentCreator('/STELLA_Documentation/docs/architecture/data-flow', 'c22'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/architecture/database',
                component: ComponentCreator('/STELLA_Documentation/docs/architecture/database', '65f'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/architecture/environment-variables',
                component: ComponentCreator('/STELLA_Documentation/docs/architecture/environment-variables', '000'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/architecture/kubernetes-orchestration',
                component: ComponentCreator('/STELLA_Documentation/docs/architecture/kubernetes-orchestration', '5c3'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/architecture/overview',
                component: ComponentCreator('/STELLA_Documentation/docs/architecture/overview', '16c'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/architecture/session-lifecycle',
                component: ComponentCreator('/STELLA_Documentation/docs/architecture/session-lifecycle', '68d'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/changelog',
                component: ComponentCreator('/STELLA_Documentation/docs/changelog', 'f4b'),
                exact: true
              },
              {
                path: '/STELLA_Documentation/docs/contributing',
                component: ComponentCreator('/STELLA_Documentation/docs/contributing', '74a'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/contributing/coding-standards',
                component: ComponentCreator('/STELLA_Documentation/docs/contributing/coding-standards', '2b1'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/contributing/coding-standards/git',
                component: ComponentCreator('/STELLA_Documentation/docs/contributing/coding-standards/git', 'c8a'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/contributing/coding-standards/python',
                component: ComponentCreator('/STELLA_Documentation/docs/contributing/coding-standards/python', 'e67'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/contributing/coding-standards/react',
                component: ComponentCreator('/STELLA_Documentation/docs/contributing/coding-standards/react', '116'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/contributing/coding-standards/testing',
                component: ComponentCreator('/STELLA_Documentation/docs/contributing/coding-standards/testing', '6e8'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/contributing/coding-standards/typescript',
                component: ComponentCreator('/STELLA_Documentation/docs/contributing/coding-standards/typescript', 'f84'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/contributing/development-setup',
                component: ComponentCreator('/STELLA_Documentation/docs/contributing/development-setup', '341'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/contributing/pull-request-process',
                component: ComponentCreator('/STELLA_Documentation/docs/contributing/pull-request-process', '62b'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/contributing/release-process',
                component: ComponentCreator('/STELLA_Documentation/docs/contributing/release-process', '9a5'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/deployment/kubernetes',
                component: ComponentCreator('/STELLA_Documentation/docs/deployment/kubernetes', 'a0b'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/deployment/message-recording',
                component: ComponentCreator('/STELLA_Documentation/docs/deployment/message-recording', 'fe5'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/deployment/monitoring',
                component: ComponentCreator('/STELLA_Documentation/docs/deployment/monitoring', '672'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/deployment/nginx-setup',
                component: ComponentCreator('/STELLA_Documentation/docs/deployment/nginx-setup', '612'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/deployment/production',
                component: ComponentCreator('/STELLA_Documentation/docs/deployment/production', 'e65'),
                exact: true
              },
              {
                path: '/STELLA_Documentation/docs/deployment/production-checklist',
                component: ComponentCreator('/STELLA_Documentation/docs/deployment/production-checklist', 'e61'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/deployment/reverse-proxy',
                component: ComponentCreator('/STELLA_Documentation/docs/deployment/reverse-proxy', '784'),
                exact: true
              },
              {
                path: '/STELLA_Documentation/docs/getting-started/first-agent',
                component: ComponentCreator('/STELLA_Documentation/docs/getting-started/first-agent', 'ba0'),
                exact: true
              },
              {
                path: '/STELLA_Documentation/docs/getting-started/installation',
                component: ComponentCreator('/STELLA_Documentation/docs/getting-started/installation', '13d'),
                exact: true
              },
              {
                path: '/STELLA_Documentation/docs/getting-started/quick-start',
                component: ComponentCreator('/STELLA_Documentation/docs/getting-started/quick-start', 'c76'),
                exact: true
              },
              {
                path: '/STELLA_Documentation/docs/guides',
                component: ComponentCreator('/STELLA_Documentation/docs/guides', '56a'),
                exact: true
              },
              {
                path: '/STELLA_Documentation/docs/guides/add-custom-ui',
                component: ComponentCreator('/STELLA_Documentation/docs/guides/add-custom-ui', '2f4'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/guides/authentication',
                component: ComponentCreator('/STELLA_Documentation/docs/guides/authentication', '10a'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/guides/build-your-own-agent',
                component: ComponentCreator('/STELLA_Documentation/docs/guides/build-your-own-agent', '14e'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/guides/custom-tools',
                component: ComponentCreator('/STELLA_Documentation/docs/guides/custom-tools', '5c6'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/guides/getting-started',
                component: ComponentCreator('/STELLA_Documentation/docs/guides/getting-started', 'bee'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/integration/frontend',
                component: ComponentCreator('/STELLA_Documentation/docs/integration/frontend', 'f27'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/integration/livekit',
                component: ComponentCreator('/STELLA_Documentation/docs/integration/livekit', '889'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/integration/livekit-production',
                component: ComponentCreator('/STELLA_Documentation/docs/integration/livekit-production', 'da8'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/plan-structure',
                component: ComponentCreator('/STELLA_Documentation/docs/plan-structure', 'ec2'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/plan-structure/deliverables',
                component: ComponentCreator('/STELLA_Documentation/docs/plan-structure/deliverables', '6ce'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/plan-structure/examples',
                component: ComponentCreator('/STELLA_Documentation/docs/plan-structure/examples', '1b2'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/plan-structure/states',
                component: ComponentCreator('/STELLA_Documentation/docs/plan-structure/states', '14d'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/plan-structure/tasks',
                component: ComponentCreator('/STELLA_Documentation/docs/plan-structure/tasks', '1d0'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/sdk/base-agent',
                component: ComponentCreator('/STELLA_Documentation/docs/sdk/base-agent', '8f2'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/sdk/message-types',
                component: ComponentCreator('/STELLA_Documentation/docs/sdk/message-types', 'af8'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/sdk/overview',
                component: ComponentCreator('/STELLA_Documentation/docs/sdk/overview', '62e'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/sdk/streaming',
                component: ComponentCreator('/STELLA_Documentation/docs/sdk/streaming', '1a7'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/sdk/tools',
                component: ComponentCreator('/STELLA_Documentation/docs/sdk/tools', '5c8'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_Documentation/docs/sdk/typescript-types',
                component: ComponentCreator('/STELLA_Documentation/docs/sdk/typescript-types', '948'),
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
    path: '/STELLA_Documentation/',
    component: ComponentCreator('/STELLA_Documentation/', 'a5b'),
    exact: true
  },
  {
    path: '*',
    component: ComponentCreator('*'),
  },
];
