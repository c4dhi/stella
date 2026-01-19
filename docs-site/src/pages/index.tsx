import React from 'react';
import Layout from '@theme/Layout';
import Hero from '../components/landing/Hero';
import Affiliations from '../components/landing/Affiliations';
import Features from '../components/landing/Features';
import HowItWorks from '../components/landing/HowItWorks';
import QuickStart from '../components/landing/QuickStart';
import AgentTypes from '../components/landing/AgentTypes';
import CTABanner from '../components/landing/CTABanner';

export default function Home(): React.ReactElement {
  return (
    <Layout
      title="STELLA Documentation"
      description="Build conversational AI agents that speak. STELLA is an open-source platform for voice-enabled AI with real-time WebRTC communication.">
      <main className="min-h-screen bg-background">
        <Hero />
        <Affiliations />
        <Features />
        <HowItWorks />
        <QuickStart />
        <AgentTypes />
        <CTABanner />
      </main>
    </Layout>
  );
}
