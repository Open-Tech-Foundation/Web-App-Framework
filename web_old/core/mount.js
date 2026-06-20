import { registerRoutes, navigate, router, setRouterConfig } from '../router/index.js'

/**
 * Bootstraps the Web App Framework Application.
 * 
 * @param {Object} options 
 * @param {Object} options.pages - Result of import.meta.glob for pages/layouts
 * @param {Function} options.guard - Optional route guard function
 * @param {string} options.targetId - ID of the root element (default: 'app')
 * @param {Object} options.config - Framework configuration (navigation, rendering)
 */
export function mountApp({ pages, guard, targetId = 'app', config = {} } = {}) {
  const finalConfig = {
    ...(typeof window !== 'undefined' ? window.__WAF_CONFIG__ : {}),
    ...config
  };

  if (finalConfig) {
    setRouterConfig(finalConfig);
  }
  console.log('🚀 Web App Framework Bootstrapping...');
  const root = document.getElementById(targetId)
  
  if (pages) {
    console.log('📑 Registering routes...');
    registerRoutes(pages)
  }
  
  if (guard) {
    console.log('🛡️ Activating route guard...');
    router.guard = guard;
  }
  
  const initialPath = window.location.pathname + window.location.search + window.location.hash;
  console.log('📍 Navigating to:', initialPath);
  navigate(initialPath, root)

  window.onpopstate = () => {
    navigate(window.location.pathname + window.location.search + window.location.hash, root)
  }
}

