import { withInstance } from '../runtime/lifecycle.js'
import { signal } from '@preact/signals-core'

export const routes = {
  pages: {},
  layouts: {},
  notFound: null
}

const isBrowser = typeof window !== 'undefined';

const routerSignals = {
  pathname: signal(isBrowser ? window.location.pathname : '/'),
  searchParams: signal(new URLSearchParams(isBrowser ? window.location.search : '')),
  hash: signal(isBrowser ? window.location.hash : ''),
  isGuarding: signal(false),
  guard: null,
  currentPage: signal(null),
  config: signal({
    navigation: (isBrowser && window.__WAF_CONFIG__?.mode?.navigation) || 'spa'
  })
};

export const router = new Proxy(routerSignals, {
  get: (target, key) => {
    if (key === "push") return (path) => navigate(path);
    if (key === "replace") return (path) => navigate(path, undefined, true);
    if (key === "config") return target.config.value;
    
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
let _routerRoot = null;

export function setRouterConfig(config) {
  routerSignals.config.value = { ...routerSignals.config.value, ...config };
}

export function registerRoutes(pages) {
  for (const path in pages) {
    const isLayout = path.endsWith('layout.jsx') || path.endsWith('layout.tsx');
    const isNotFound = path.endsWith('404.jsx') || path.endsWith('404.tsx');
    
    let route = path
      .replace(/^.*\/app/, '') 
      .replace(/\/(page|layout|404)\.(jsx|tsx)$/, '');
    
    if (route === '') route = '/';
    
    const isDev = typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
    
    if (isNotFound) {
      routes.notFound = isDev ? { module: pages[path], sourceFile: path } : pages[path];
    } else if (isLayout) {
      routes.layouts[route] = isDev ? { module: pages[path], sourceFile: path } : pages[path];
    } else {
      routes.pages[route] = isDev ? { module: pages[path], sourceFile: path } : pages[path];
    }
  }
}

function matchRoute(path) {
  for (const route in routes.pages) {
    const pattern = route
      .replace(/\[\.\.\.([^\]]+)\]/g, '(?<$1>.+)')
      .replace(/\[([^\]]+)\]/g, '(?<$1>[^/]+)');
    
    const regex = new RegExp(`^${pattern}/?$`);
    const match = path.match(regex);
    if (match) {
      const params = { ...(match.groups || {}) };
      
      for (const key in params) {
        if (route.includes(`[...${key}]`)) {
          params[key] = params[key].split('/');
        }
      }

      const isDev = typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
      return { 
        page: isDev ? routes.pages[route].module : routes.pages[route], 
        params,
        route,
        sourceFile: isDev ? routes.pages[route].sourceFile : null
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

export async function navigate(path, root, replace = false, isPopState = false) {
  if (!path) return;
  if (root) _routerRoot = root;
  const targetRoot = _routerRoot || (typeof document !== 'undefined' ? document.getElementById("app") : null);

  if (typeof window !== 'undefined' && window.navigation && !isPopState) {
    const url = new URL(path, window.location.origin);
    if (url.pathname + url.search + url.hash !== window.location.pathname + window.location.search + window.location.hash) {
      return window.navigation.navigate(path, { history: replace ? 'replace' : 'push' });
    }
  }

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

  const isDev = typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
  const match = matchRoute(pathname) || (routes.notFound ? { 
    page: isDev ? routes.notFound.module : routes.notFound, 
    params: {}, 
    route: null, 
    sourceFile: isDev ? routes.notFound.sourceFile : null 
  } : null);
  
  if (match) {
    const { page, params, route, sourceFile } = match;
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
      routerSignals.currentPage.value = { route, sourceFile };
    }
    
    if (currentPageInstance && currentPageInstance._onCleanups) {
      currentPageInstance._onCleanups.forEach(fn => fn());
    }
    
    const instance = { _onMounts: [], _onCleanups: [] };
    currentPageInstance = instance;

    const layoutChain = [];
    if (route) {
      let currentPath = route;
      const isDev = typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
      while (true) {
        if (routes.layouts[currentPath]) {
          layoutChain.unshift(isDev ? routes.layouts[currentPath].module : routes.layouts[currentPath]);
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

    if (targetRoot) {
      if (typeof window !== 'undefined') {
        targetRoot.innerHTML = '';
        targetRoot.appendChild(content);
      }
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
  if (window.navigation) {
    window.navigation.addEventListener('navigate', (event) => {
      // Respect MPA mode
      if (routerSignals.config.peek().navigation === 'mpa') return;

      if (!event.canIntercept || event.hashChange || event.downloadRequest || event.formData) {
        return;
      }

      const url = new URL(event.destination.url);
      if (url.origin !== window.location.origin) return;

      event.intercept({
        async handler() {
          const fullPath = url.pathname + url.search + url.hash;
          routerSignals.pathname.value = url.pathname;
          routerSignals.searchParams.value = new URLSearchParams(url.search);
          routerSignals.hash.value = url.hash;
          await navigate(fullPath, _routerRoot, false, true);
        }
      });
    });
  } else {
    window.addEventListener('popstate', () => {
      if (routerSignals.config.peek().navigation === 'mpa') return;
      const fullPath = window.location.pathname + window.location.search + window.location.hash;
      routerSignals.pathname.value = window.location.pathname;
      routerSignals.searchParams.value = new URLSearchParams(window.location.search);
      routerSignals.hash.value = window.location.hash;
      navigate(fullPath, _routerRoot, false, true);
    });
    window.addEventListener('hashchange', () => {
      routerSignals.hash.value = window.location.hash;
      scrollToHash(window.location.hash);
    });
  }
}
