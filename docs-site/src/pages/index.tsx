import React, { useEffect } from 'react';
import Layout from '@theme/Layout';
import Hero from '../components/landing/Hero';
import Affiliations from '../components/landing/Affiliations';
import UseCases from '../components/landing/UseCases';
import Features from '../components/landing/Features';
// import HowItWorks from '../components/landing/HowItWorks'; // Hidden for now
import QuickStart from '../components/landing/QuickStart';
import AgentTypes from '../components/landing/AgentTypes';
import CTABanner from '../components/landing/CTABanner';

export default function Home(): React.ReactElement {
  useEffect(() => {
    document.body.classList.add('landing-page');
    return () => {
      document.body.classList.remove('landing-page');
    };
  }, []);

  return (
    <Layout
      title="STELLA — Voice AI for Research"
      description="STELLA is an open-source platform for running voice conversations with research participants—interviews, digital interventions, and guided dialogues. Design without code and run it on your own hardware."
      wrapperClassName="landing-page-wrapper">
      <main className="min-h-screen bg-background landing-page-content">
        <Hero />
        <Affiliations />
        <UseCases />
        <Features />
        {/* <HowItWorks /> */}
        <QuickStart />
        <AgentTypes />
        <CTABanner />
      </main>
    </Layout>
  );
}
