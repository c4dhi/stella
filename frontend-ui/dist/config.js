// Default runtime configuration for local development
// In production, this file is replaced by entrypoint.sh with actual values
window.__ENV__ = {
  apiUrl: 'http://localhost:3000',
  livekitUrl: 'ws://localhost:7880',
  livekitApiKey: 'devkey',
  livekitApiSecret: 'secret'
};
