import { withInstance } from '../runtime/lifecycle.js'
import { signal } from '@preact/signals-core'

export const routes = {
  pages: {},
  layouts: {},
  notFound: null
}

const routerSignals = {
  pathname: signal(window.location.pathname),
  searchParams: signal(new URLSearchParams(window.location.search)),
  hash: signal(window.location.hash),
  isGuarding: signal(false),
  guard: null
};

export const router = new Proxy(routerSignals, {
  get: (target, key) => {
    if (key === "push") return (path) => navigate(path);
    if (key === "replace") return (path) => navigate(path, undefined, true);
    
    const s = target[key];
    if (s && typeof s === 'object' && 'value' in s && typeof s.subscribe === 'function') {
      return s.value;
    }
    return s;
  },
  set: (target, key, val) => {
    const s = target[key];
    if (s && typeof s === 'object' && 'value' in s && typeof s.subscribe === 'function') {
      s.value = val;
    } else {
      target[key] = val;
    }
    return true;
  }
});

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

export async function navigate(path, root = document.getElementById("app"), replace = false, isPopState = false) {
  if (!path) return;
  
  const url = new URL(path, window.location.origin);
  const pathname = url.pathname;
  const oldPathname = window.location.pathname;
  const oldSearch = window.location.search;
  const oldHash = window.location.hash;
  
  // 1. Run Route Guard if registered
  if (router.guard) {
    const match = matchRoute(pathname);
    const to = {
      path: pathname,
      fullPath: pathname + url.search + url.hash,
      params: match?.params || {},
      query: Object.fromEntries(new URLSearchParams(url.search))
    };

    routerSignals.isGuarding.value = true;
    
    try {
      await new Promise((resolve, reject) => {
        const tools = {
          next: () => resolve(),
          redirect: (p) => {
            navigate(p, root, false);
            reject('redirected');
          },
          replace: (p) => {
            navigate(p, root, true);
            reject('redirected');
          }
        };
        
        // Execute guard
        Promise.resolve(routerSignals.guard(to, tools)).catch(reject);
      });
    } catch (e) {
      routerSignals.isGuarding.value = false;
      if (e === 'redirected') return;
      console.error('Route Guard Error:', e);
      return;
    }
    
    routerSignals.isGuarding.value = false;
  }

  if (!isPopState) {
    routerSignals.pathname.value = pathname;
    routerSignals.searchParams.value = new URLSearchParams(url.search);
    routerSignals.hash.value = url.hash;
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

    if (!root) root = document.getElementById("app");
    if (root) {
      root.innerHTML = '';
      root.appendChild(content);
    }

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
    if (root) root.innerHTML = '<h1>404 Not Found</h1>';
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const fullPath = window.location.pathname + window.location.search + window.location.hash;
    routerSignals.pathname.value = window.location.pathname;
    routerSignals.searchParams.value = new URLSearchParams(window.location.search);
    routerSignals.hash.value = window.location.hash;
    navigate(fullPath, undefined, false, true);
  });
  window.addEventListener('hashchange', () => {
    routerSignals.hash.value = window.location.hash;
    scrollToHash(window.location.hash);
  });
}
