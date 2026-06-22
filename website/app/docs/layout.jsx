import { Link, router } from "@opentf/web";

const NavLink = (props) => {
  const isHashLink = props.href.includes('#');
  const path = isHashLink ? props.href.split('#')[0] : props.href;
  const hash = isHashLink ? props.href.split('#')[1] : null;

  const isActive = $derived(() => {
    if (isHashLink && hash) {
      const currentHash = router.hash || "#introduction";
      return currentHash === `#${hash}` && router.pathname === path;
    }
    return router.pathname === path;
  });
  
  const handleClick = (e) => {
    if (isHashLink && hash && router.pathname === path) {
      e.preventDefault();
      window._isProgrammaticScroll = true;
      router.hash = `#${hash}`;
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => window._isProgrammaticScroll = false, 1000);
    } else {
      // Standard navigation
      router.push(props.href);
    }
  };
  
  return (
    <a 
      href={props.href} 
      onclick={handleClick}
      className={isActive 
        ? "px-2 py-1.5 text-sm font-bold text-accent bg-accent/10 rounded-md transition-all block w-full text-left cursor-pointer" 
        : "px-2 py-1.5 text-sm text-[var(--text-muted)] hover:text-accent hover:bg-accent/5 rounded-md transition-all block w-full text-left cursor-pointer"
      }
    >
      {props.children}
    </a>
  );
};

export default function DocsLayout(props) {

  // Auto-highlight sidebar on scroll
  $effect(() => {
    const sections = [
      'introduction', 'installation', 'architecture', 
      'zero-vdom', 'web-components', 'props', 
      'state', 'derived', 'effect', 
      'file-routing', 'layouts', 'dynamic-routes', 'router-api',
      'lists', 'conditionals', 'lifecycle', 'refs', 'global-state', 'forms', 'testing',
      'api-macros', 'api-hooks', 'api-router', 'api-attributes'
    ];
    
    const observer = new IntersectionObserver((entries) => {
      if (window._isProgrammaticScroll) return;
      
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          router.hash = `#${entry.target.id}`;
        }
      });
    }, { threshold: 0.5, rootMargin: '-10% 0px -80% 0px' });

    sections.forEach(id => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  });

  return (
    <div className="flex-1 max-w-7xl mx-auto px-8 w-full flex gap-12 py-12">
      <aside className="w-64 shrink-0 hidden md:block">
        <div className="sticky top-24 space-y-8 max-h-[calc(100vh-120px)] overflow-y-auto pr-4 scrollbar-hide hover:scrollbar-default">
          
          <div>
            <h4 className="font-bold text-[var(--text-main)] mb-3 px-2 text-xs uppercase tracking-wider opacity-50">Getting Started</h4>
            <div className="flex flex-col space-y-1">
              <NavLink href="/docs#introduction">Introduction</NavLink>
              <NavLink href="/docs#installation">Installation</NavLink>
              <NavLink href="/docs#architecture">Architecture</NavLink>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-[var(--text-main)] mb-3 px-2 text-xs uppercase tracking-wider opacity-50">Core Concepts</h4>
            <div className="flex flex-col space-y-1">
              <NavLink href="/docs#zero-vdom">Zero-VDOM</NavLink>
              <NavLink href="/docs#web-components">Web Components</NavLink>
              <NavLink href="/docs#props">Component Props</NavLink>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-[var(--text-main)] mb-3 px-2 text-xs uppercase tracking-wider opacity-50">Reactivity</h4>
            <div className="flex flex-col space-y-1">
              <NavLink href="/docs#state">$state Macro</NavLink>
              <NavLink href="/docs#derived">$derived Macro</NavLink>
              <NavLink href="/docs#effect">$effect Macro</NavLink>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-[var(--text-main)] mb-3 px-2 text-xs uppercase tracking-wider opacity-50">Routing</h4>
            <div className="flex flex-col space-y-1">
              <NavLink href="/docs#file-routing">File-based Routing</NavLink>
              <NavLink href="/docs#layouts">Layouts</NavLink>
              <NavLink href="/docs#dynamic-routes">Dynamic Routes</NavLink>
              <NavLink href="/docs#router-api">Router API</NavLink>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-[var(--text-main)] mb-3 px-2 text-xs uppercase tracking-wider opacity-50">Advanced</h4>
            <div className="flex flex-col space-y-1">
              <NavLink href="/docs#lists">List Rendering</NavLink>
              <NavLink href="/docs#conditionals">Conditional Rendering</NavLink>
              <NavLink href="/docs#lifecycle">Lifecycle Hooks</NavLink>
              <NavLink href="/docs#refs">DOM References</NavLink>
              <NavLink href="/docs#global-state">Global State</NavLink>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-[var(--text-main)] mb-3 px-2 text-xs uppercase tracking-wider opacity-50">Libraries</h4>
            <div className="flex flex-col space-y-1">
              {/* web-form docs are deferred until @opentf/web-form is ported to the new runtime */}
              <NavLink href="/docs#testing">Testing (web-test)</NavLink>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-[var(--text-main)] mb-3 px-2 text-xs uppercase tracking-wider opacity-50">API Reference</h4>
            <div className="flex flex-col space-y-1">
              <NavLink href="/docs#api-macros">Macros</NavLink>
              <NavLink href="/docs#api-hooks">Hooks</NavLink>
              <NavLink href="/docs#api-router">Router</NavLink>
              <NavLink href="/docs#api-attributes">Elements</NavLink>
            </div>
          </div>

        </div>
      </aside>
      <main className="flex-1 min-w-0">
        {props.children}
      </main>
    </div>
  );
}
