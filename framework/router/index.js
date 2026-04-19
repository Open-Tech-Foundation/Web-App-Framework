export const routes = {}

export function registerRoutes(pages) {
  for (const path in pages) {
    // Handle paths like ../../app/page.jsx or ./app/page.jsx or /app/page.jsx
    let route = path
      .replace(/^.*\/app/, '') // Remove everything up to /app
      .replace(/\/page\.(jsx|tsx)$/, '') // Remove /page.jsx or /page.tsx
    
    if (route === '') route = '/'
    routes[route] = pages[path]
    console.log('Registered route:', route, 'from', path)
  }
}

export function navigate(path, root) {
  const page = routes[path] || routes['/']
  if (page && page.render) {
    root.innerHTML = ''
    page.render(root)
    window.history.pushState({}, '', path)
  }
}
