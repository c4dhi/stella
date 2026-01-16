import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/STELLA_backend/__docusaurus/debug',
    component: ComponentCreator('/STELLA_backend/__docusaurus/debug', '5a6'),
    exact: true
  },
  {
    path: '/STELLA_backend/__docusaurus/debug/config',
    component: ComponentCreator('/STELLA_backend/__docusaurus/debug/config', '8f2'),
    exact: true
  },
  {
    path: '/STELLA_backend/__docusaurus/debug/content',
    component: ComponentCreator('/STELLA_backend/__docusaurus/debug/content', '2e2'),
    exact: true
  },
  {
    path: '/STELLA_backend/__docusaurus/debug/globalData',
    component: ComponentCreator('/STELLA_backend/__docusaurus/debug/globalData', '9ca'),
    exact: true
  },
  {
    path: '/STELLA_backend/__docusaurus/debug/metadata',
    component: ComponentCreator('/STELLA_backend/__docusaurus/debug/metadata', '478'),
    exact: true
  },
  {
    path: '/STELLA_backend/__docusaurus/debug/registry',
    component: ComponentCreator('/STELLA_backend/__docusaurus/debug/registry', 'ff1'),
    exact: true
  },
  {
    path: '/STELLA_backend/__docusaurus/debug/routes',
    component: ComponentCreator('/STELLA_backend/__docusaurus/debug/routes', 'ca1'),
    exact: true
  },
  {
    path: '/STELLA_backend/docs',
    component: ComponentCreator('/STELLA_backend/docs', '393'),
    routes: [
      {
        path: '/STELLA_backend/docs',
        component: ComponentCreator('/STELLA_backend/docs', 'aff'),
        routes: [
          {
            path: '/STELLA_backend/docs',
            component: ComponentCreator('/STELLA_backend/docs', '0bd'),
            routes: [
              {
                path: '/STELLA_backend/docs',
                component: ComponentCreator('/STELLA_backend/docs', '248'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/agent-sdk/audio-pipeline',
                component: ComponentCreator('/STELLA_backend/docs/agent-sdk/audio-pipeline', '34d'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/agent-sdk/base-agent',
                component: ComponentCreator('/STELLA_backend/docs/agent-sdk/base-agent', 'fad'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/agent-sdk/building-custom-agent',
                component: ComponentCreator('/STELLA_backend/docs/agent-sdk/building-custom-agent', '4bc'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/agent-sdk/getting-started',
                component: ComponentCreator('/STELLA_backend/docs/agent-sdk/getting-started', '6d2'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/agent-sdk/message-types',
                component: ComponentCreator('/STELLA_backend/docs/agent-sdk/message-types', '8b3'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/agent-sdk/overview',
                component: ComponentCreator('/STELLA_backend/docs/agent-sdk/overview', '01f'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/agent-sdk/progress-tracking',
                component: ComponentCreator('/STELLA_backend/docs/agent-sdk/progress-tracking', 'a52'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/agent-sdk/tools',
                component: ComponentCreator('/STELLA_backend/docs/agent-sdk/tools', '493'),
                exact: true,
                sidebar: "docsSidebar"
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
                path: '/STELLA_backend/docs/deployment/kubernetes',
                component: ComponentCreator('/STELLA_backend/docs/deployment/kubernetes', 'bb5'),
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
                component: ComponentCreator('/STELLA_backend/docs/deployment/production', '5d6'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/deployment/reverse-proxy',
                component: ComponentCreator('/STELLA_backend/docs/deployment/reverse-proxy', '5bb'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/getting-started/first-agent',
                component: ComponentCreator('/STELLA_backend/docs/getting-started/first-agent', '9f8'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/getting-started/installation',
                component: ComponentCreator('/STELLA_backend/docs/getting-started/installation', 'cfb'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/getting-started/quick-start',
                component: ComponentCreator('/STELLA_backend/docs/getting-started/quick-start', 'cb3'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/STELLA_backend/docs/guides',
                component: ComponentCreator('/STELLA_backend/docs/guides', '917'),
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
              }
            ]
          }
        ]
      }
    ]
  },
  {
    path: '*',
    component: ComponentCreator('*'),
  },
];
