// Client module to detect landing page and apply body class
export function onRouteDidUpdate({ location }) {
  const isLandingPage = location.pathname === '/' || location.pathname === '/STELLA_backend/' || location.pathname === '/STELLA_backend';

  // Add/remove landing-page class on body for styling purposes
  document.body.classList.toggle('landing-page', isLandingPage);

  // Cleanup on route change
  return () => {
    document.body.classList.remove('landing-page');
  };
}
