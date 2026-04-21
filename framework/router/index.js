import { withInstance } from '../runtime/lifecycle.js'
import { signal } from '@preact/signals-core'

export const routes = {
  pages: {},
  layouts: {},
  notFound: null
}

export const router = {
  pathname: signal(window.location.pathname),
  searchParams: signal(new URLSearchParams(window.location.search)),
  hash: signal(window.location.hash),
  push: (path) => navigate(path),
  replace: (path) => navigate(path, undefined, true)
}

let currentPageInstance = null;

export function registerRoutes(pages) {
  for (const path in pages) {
    const isLayout = path.endsWith('layout.jsx') || path.endsWith('layout.tsx');
    const isNotFound = path.endsWith('404.jsx') || path.endsWith('404.tsx');
    
    let route = path
      .replace(/^.*\/app/, '') 
      .replace(/\/(page|layout|404)\.(jsx|tsx)$/, '');
    
    if (route === '') route = '/';
    
    if (isNotFound) {
      routes.notFound = pages[path];
    } else if (isLayout) {
      routes.layouts[route] = pages[path];
    } else {
      routes.pages[route] = pages[path];
    }
  }
}

function matchRoute(path) {
  for (const route in routes.pages) {
    const pattern = route
      .replace(/\[\.\.\.([^\]]+)\]/g, '(?<$1>.+)')
      .replace(/\[([^\]]+)\]/g, '(?<$1>[^/]+)');
    
    const regex = new RegExp(`^${pattern}$`);
    const match = path.match(regex);
    if (match) {
      const params = { ...(match.groups || {}) };
      
      for (const key in params) {
        if (route.includes(`[...${key}]`)) {
          params[key] = params[key].split('/');
        }
      }

      return { 
        page: routes.pages[route], 
        params,
        route
      };
    }
  }
  return null;
}

function scrollToHash(hash) {
  if (!hash) return;
  const id = hash.replace('#', '');
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth' });
  }
}

export function navigate(path, root = document.getElementById("app"), replace = false, isPopState = false) {
  if (!path) return;
  
  const url = new URL(path, window.location.origin);
  const pathname = url.pathname;
  const oldPathname = window.location.pathname;
  const oldSearch = window.location.search;
  const oldHash = window.location.hash;
  
  if (!isPopState) {
    router.pathname.value = pathname;
    router.searchParams.value = new URLSearchParams(url.search);
    router.hash.value = url.hash;
  }

  // If only hash changed, don't re-render everything
  if (pathname === oldPathname && url.search === oldSearch && url.hash !== oldHash) {
    if (!isPopState) {
      if (replace) window.history.replaceState({}, '', path);
      else window.history.pushState({}, '', path);
    }
    scrollToHash(url.hash);
    return;
  }

  const match = matchRoute(pathname) || (routes.notFound ? { page: routes.notFound, params: {}, route: null } : null);
  
  if (match) {
    const { page, params, route } = match;
    
    if (currentPageInstance && currentPageInstance._onCleanups) {
      currentPageInstance._onCleanups.forEach(fn => fn());
    }
    
    const instance = { _onMounts: [], _onCleanups: [] };
    currentPageInstance = instance;

    const layoutChain = [];
    if (route) {
      let currentPath = route;
      while (true) {
        if (routes.layouts[currentPath]) {
          layoutChain.unshift(routes.layouts[currentPath]);
        }
        if (currentPath === '/') break;
        currentPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
      }
    }

    let content = document.createDocumentFragment();
    withInstance(instance, () => {
      page.render(content, { params });

      for (let i = layoutChain.length - 1; i >= 0; i--) {
        const layout = layoutChain[i];
        const nextContent = document.createDocumentFragment();
        layout.render(nextContent, { children: content, params });
        content = nextContent;
      }
    });

    root.innerHTML = '';
    root.appendChild(content);

    if (instance._onMounts) {
      instance._onMounts.forEach(fn => fn());
    }

    if (!isPopState) {
      if (replace) window.history.replaceState({}, '', path);
      else window.history.pushState({}, '', path);
    }

    // Scroll to hash after render
    setTimeout(() => scrollToHash(url.hash), 100);
  } else {
    root.innerHTML = '<h1>404 Not Found</h1>';
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const fullPath = window.location.pathname + window.location.search + window.location.hash;
    router.pathname.value = window.location.pathname;
    router.searchParams.value = new URLSearchParams(window.location.search);
    router.hash.value = window.location.hash;
    navigate(fullPath, undefined, false, true);
  });
  window.addEventListener('hashchange', () => {
    router.hash.value = window.location.hash;
    scrollToHash(window.location.hash);
  });
}
