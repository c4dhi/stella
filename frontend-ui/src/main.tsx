import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { initRuntimeConfig } from './config/runtime'

// Initialize runtime configuration before rendering the app
initRuntimeConfig().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}).catch((error) => {
  console.error('[main] Failed to initialize runtime config:', error)
  // Still render the app with defaults
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
