import { mountApp } from "@opentf/mwaf-core";

// 1. Discover Website Pages
const pages = import.meta.glob('./app/**/page.{jsx,tsx}', { eager: true });
const layouts = import.meta.glob('./app/**/layout.{jsx,tsx}', { eager: true });
const notFound = import.meta.glob('./app/**/404.{jsx,tsx}', { eager: true });

// 2. Bootstrap
mountApp({ 
  pages: { ...pages, ...layouts, ...notFound } 
});
