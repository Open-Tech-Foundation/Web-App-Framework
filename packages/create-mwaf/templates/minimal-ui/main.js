import { mountApp } from "@opentf/mwaf-core";

// 1. Discover Pages & Layouts
const pages = import.meta.glob('./app/**/{page,layout,404}.{jsx,tsx}', { eager: true });

// 2. Discover Route Guard (Optional)
const guards = import.meta.glob('./app/routeGuard.{js,ts,jsx,tsx}', { eager: true });
const guard = Object.values(guards)[0]?.default;

// 3. Bootstrap the MWAF Application
mountApp({ 
  pages, 
  guard 
});
