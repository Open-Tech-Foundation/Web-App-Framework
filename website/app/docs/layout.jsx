import { Link, router } from "@opentf/mwaf-core";

const navLink = (props) => {
  const id = props.href.split('#')[1];
  const isActive = $derived(() => {
    const currentHash = router.hash || "#introduction";
    return currentHash === `#${id}`;
  });
  
  const handleClick = (e) => {
    e.preventDefault();
    window._isProgrammaticScroll = true;
    router.hash = `#${id}`;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => window._isProgrammaticScroll = false, 1000);
  };
  
  return (
    <a 
      href={props.href} 
      onclick={handleClick}
      className={isActive 
        ? "px-2 py-1.5 text-sm font-bold text-accent bg-accent/10 rounded-md transition-all block w-full text-left cursor-pointer" 
        : "px-2 py-1.5 text-sm text-slate-500 hover:text-accent hover:bg-accent/5 rounded-md transition-all block w-full text-left cursor-pointer"
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
      'lists', 'conditionals', 'lifecycle', 'refs', 'global-state',
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
            <h4 className="font-bold text-slate-900 mb-3 px-2 text-xs uppercase tracking-wider opacity-50">Getting Started</h4>
            <div className="flex flex-col space-y-1">
              {navLink({ href: "/docs#introduction", children: "Introduction" })}
              {navLink({ href: "/docs#installation", children: "Installation" })}
              {navLink({ href: "/docs#architecture", children: "Architecture" })}
            </div>
          </div>

          <div>
            <h4 className="font-bold text-slate-900 mb-3 px-2 text-xs uppercase tracking-wider opacity-50">Core Concepts</h4>
            <div className="flex flex-col space-y-1">
              {navLink({ href: "/docs#zero-vdom", children: "Zero-VDOM" })}
              {navLink({ href: "/docs#web-components", children: "Web Components" })}
              {navLink({ href: "/docs#props", children: "Component Props" })}
            </div>
          </div>

          <div>
            <h4 className="font-bold text-slate-900 mb-3 px-2 text-xs uppercase tracking-wider opacity-50">Reactivity</h4>
            <div className="flex flex-col space-y-1">
              {navLink({ href: "/docs#state", children: "$state Macro" })}
              {navLink({ href: "/docs#derived", children: "$derived Macro" })}
              {navLink({ href: "/docs#effect", children: "$effect Macro" })}
            </div>
          </div>

          <div>
            <h4 className="font-bold text-slate-900 mb-3 px-2 text-xs uppercase tracking-wider opacity-50">Routing</h4>
            <div className="flex flex-col space-y-1">
              {navLink({ href: "/docs#file-routing", children: "File-based Routing" })}
              {navLink({ href: "/docs#layouts", children: "Layouts" })}
              {navLink({ href: "/docs#dynamic-routes", children: "Dynamic Routes" })}
              {navLink({ href: "/docs#router-api", children: "Router API" })}
            </div>
          </div>

          <div>
            <h4 className="font-bold text-slate-900 mb-3 px-2 text-xs uppercase tracking-wider opacity-50">Advanced</h4>
            <div className="flex flex-col space-y-1">
              {navLink({ href: "/docs#lists", children: "List Rendering" })}
              {navLink({ href: "/docs#conditionals", children: "Conditional Rendering" })}
              {navLink({ href: "/docs#lifecycle", children: "Lifecycle Hooks" })}
              {navLink({ href: "/docs#refs", children: "DOM References" })}
              {navLink({ href: "/docs#global-state", children: "Global State" })}
            </div>
          </div>

          <div>
            <h4 className="font-bold text-slate-900 mb-3 px-2 text-xs uppercase tracking-wider opacity-50">API Reference</h4>
            <div className="flex flex-col space-y-1">
              {navLink({ href: "/docs#api-macros", children: "Macros" })}
              {navLink({ href: "/docs#api-hooks", children: "Hooks" })}
              {navLink({ href: "/docs#api-router", children: "Router" })}
              {navLink({ href: "/docs#api-attributes", children: "Elements" })}
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
