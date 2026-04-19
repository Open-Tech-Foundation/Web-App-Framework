import { registerRoutes, navigate } from '../router/index'

export function mountApp() {
  console.log('mountApp() called');
  const root = document.getElementById('app')
  
  const pages = import.meta.glob('../../app/**/page.{jsx,tsx}', { eager: true })
  console.log('Pages found:', Object.keys(pages));
  
  registerRoutes(pages)
  
  const initialPath = window.location.pathname
  console.log('Initial path:', initialPath);
  navigate(initialPath, root)

  window.onpopstate = () => {
    navigate(window.location.pathname, root)
  }
}
