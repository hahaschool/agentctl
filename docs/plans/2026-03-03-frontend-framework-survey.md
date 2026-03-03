# Frontend Framework Survey for AgentCTL Web Dashboard

**Date:** 2026-03-03
**Status:** Research / Proposal
**Author:** Agent-assisted

## Context

The `@agentctl/web` package is currently a plain Vite + React 19 SPA with:
- No router (page switching via `useState<Page>` in `App.tsx`)
- No data-fetching library (custom `use-polling` and `use-websocket` hooks)
- No state management library
- Inline styles (CSS variables for theming, no CSS framework)
- 6 pages: Dashboard, Machines, Agents, Sessions, Discover, Logs
- Zero external dependencies beyond React and `@agentctl/shared`

The dashboard is an **internal admin tool** (no SEO, no public traffic). It needs:
- Real-time monitoring via SSE streams and WebSocket
- Multi-panel layouts (list + detail side-by-side)
- Data tables with sorting, filtering, pagination
- Dark theme UI
- Toast notifications
- Settings/configuration pages (router config, LiteLLM, etc.)
- Deep-linkable URLs (e.g., `/sessions/:id`, `/agents/:id`)

A separate React Native (Expo) mobile app exists in `packages/mobile/`.

---

## Options Evaluated

### Option 1: Stay with Vite + Add React Router + TanStack Query (Incremental)

**What it is:** Keep the existing Vite SPA setup. Add React Router v7 in library mode for routing. Add TanStack Query v5 for data fetching, caching, and polling. Add a CSS framework (Tailwind + shadcn/ui) for styling.

**Routing:** Code-based routes using `createBrowserRouter` with JSX `<Route>` elements. No file-based routing. Supports nested layouts, `<Outlet>`, URL params, search params. Library mode does not provide the enhanced type safety of framework mode.

**Data fetching:** TanStack Query handles caching, background refetching, polling (`refetchInterval`), and stale-while-revalidate. SSE/WebSocket integration requires manual wiring: use `queryClient.setQueryData()` to push real-time updates into the cache, or `queryClient.invalidateQueries()` to trigger refetches on WebSocket events. This is a well-documented pattern.

**Bundle size:** Minimal overhead. TanStack Query v5 is ~13 kB gzipped (20% smaller than v4). React Router v7 library mode is ~11 kB gzipped. Total routing + data layer adds ~24 kB.

**Migration effort:** **Low.** Replace the `useState<Page>` switch with `<RouterProvider>` and route definitions. Wrap fetch calls in `useQuery` hooks. Each page component stays as-is, just gets a route path. Can migrate one page at a time.

**Community:** React Router is the most widely used React router (installed by default with Create React App projects for years). TanStack Query is the dominant server-state library. Both have extensive documentation, active maintenance, and large ecosystems.

**Overkill factor:** Not overkill at all. This is the lightest viable upgrade path.

---

### Option 2: Next.js App Router (Full Framework)

**What it is:** Replace the Vite SPA with a Next.js application. Uses the App Router (React Server Components, Server Actions, file-based routing).

**Routing:** File-based routing in the `app/` directory. Layouts, nested routes, parallel routes, and intercepting routes are built in. Route groups for organizational purposes.

**Data fetching:** Server Components fetch data on the server by default. Client components can use TanStack Query or SWR. Built-in `fetch()` caching and revalidation. Server Actions for mutations.

**Bundle size:** Next.js framework overhead is significant (~80-100 kB baseline). However, Server Components reduce client-side JavaScript because server-rendered content does not ship component code to the browser.

**Migration effort:** **High.** Fundamentally different architecture. Need to restructure the entire project: move from SPA to a Node.js server, adopt file-based routing conventions, decide what is a Server Component vs. Client Component, handle the `"use client"` boundary. The existing inline-style approach works but the Next.js ecosystem strongly gravitates toward Tailwind. Real-time features (SSE, WebSocket) require careful handling -- WebSocket connections must originate from client components, and SSE streams need a custom API route or middleware.

**Community:** Largest React framework community. Extensive documentation, massive ecosystem of templates, libraries, and deployment platforms. However, growing developer frustration with complexity, caching behavior, and Vercel lock-in concerns as of 2025-2026.

**Overkill factor:** **Overkill for this use case.** Next.js excels at SEO, static generation, and hybrid rendering -- none of which matter for an internal admin dashboard behind authentication. The server-rendering infrastructure adds complexity without proportional value. As multiple 2026 analyses note: "For purely client-side applications like dashboards or internal tools, Next.js can feel over-engineered."

---

### Option 3: React Router v7 Framework Mode (Remix Evolution)

**What it is:** React Router v7 framework mode is the successor to Remix. It provides file-based routing, loaders, actions, and optional SSR within a Vite-based build system.

**Routing:** File-based routing via `routes.ts` configuration file. Supports nested routes with layouts. Type-safe route params and search params in framework mode. Can run in SPA mode (`ssr: false`) to generate a static `index.html` for client-only rendering.

**Data fetching:** Route-level `loader` functions fetch data before the component renders. `action` functions handle mutations. In SPA mode, loaders run on the client. Can combine with TanStack Query for caching and real-time updates.

**Bundle size:** Built on Vite, so dev performance is excellent. Framework overhead is moderate, smaller than Next.js. SPA mode output is comparable to a standard Vite build.

**Migration effort:** **Medium.** Need to restructure to file-based routes and adopt the loader/action pattern. The loader pattern is a conceptual shift from "fetch in component" to "fetch before render." SPA mode has documented limitations: loaders only work on the root route when `ssr: false`, you cannot use `action` or `headers` functions on non-root routes. These limitations are awkward for a data-heavy dashboard.

**Community:** Active and stable. React Router v7 is at v7.13+ as of early 2026. The Remix community has migrated here. Good documentation. However, the SPA mode limitations are a real concern -- the framework is clearly designed SSR-first, and SPA mode feels like a second-class citizen.

**Overkill factor:** **Somewhat overkill.** The loader/action pattern is elegant for full-stack apps with SSR. For a client-only dashboard that talks to a separate API server, the pattern adds indirection without clear benefit. The SPA mode limitations further reduce the value proposition.

---

### Option 4: TanStack Start (Newest Option, Built on Vinxi)

**What it is:** A full-stack React framework from the TanStack ecosystem, built on TanStack Router and powered by Vinxi/Vite. Emphasizes type safety, explicit control, and integration with the TanStack ecosystem (Query, Table, Form, Virtual).

**Routing:** File-based routing with automatic code splitting (reduces initial bundle by ~40%). Also supports code-based routing. First-class TypeScript integration -- route params, search params, and loader data are all fully typed at compile time. This is the strongest type-safety story of any option.

**Data fetching:** Built-in route loaders with TanStack Query integration. Server functions for API calls. SPA mode available (`defaultSsr: false`) which disables server-side rendering while keeping server functions operational. Selective SSR allows per-route control.

**Bundle size:** TanStack Router core is ~12 kB gzipped. With TanStack Start's framework layer, total overhead is moderate. Automatic code splitting in file-based routing mode helps keep per-page bundles small. Built on Vite, so dev performance is fast.

**Migration effort:** **Medium-High.** New framework with new conventions. Need to learn TanStack Router's route definitions (different from React Router). The file-based routing uses a flat file convention (`routes/sessions.$id.tsx`) that takes getting used to. The TanStack ecosystem integration is a strength if you are also using TanStack Table and TanStack Query (which you likely will for data tables), but it is a lot of new API surface to learn at once.

**Community:** Growing rapidly but still smaller than React Router or Next.js. TanStack Start is in **Release Candidate** status as of early 2026, with v1.0 expected soon but not yet shipped. The API is considered stable and feature-complete, but production use carries the inherent risk of a pre-1.0 framework. TanStack Router (the underlying router) is stable at v1.

**Overkill factor:** **Moderate.** SPA mode works well and avoids unnecessary server infrastructure. The framework layer adds capabilities that a dashboard can use (type-safe routes, automatic code splitting). But adopting a pre-1.0 framework for an internal tool is a risk-reward tradeoff.

---

### Option 5: Vite + Wouter or TanStack Router (Lightweight Routing Only)

**What it is:** Keep Vite as the build tool. Add only a lightweight router without adopting a full framework. Two sub-options:

**5a. Wouter (~2.2 kB gzipped):**
- Minimalist router with `<Route>`, `<Link>`, `useLocation`, `useRoute`
- No file-based routing, no loaders, no code splitting
- Hook-based API, very simple mental model
- Does not support nested layouts natively (can be worked around)
- Missing features: route-based code splitting, search param management, type-safe params

**5b. TanStack Router (~12 kB gzipped, no TanStack Start):**
- Can be used standalone without the Start framework
- Supports both code-based and file-based routing (file-based requires the Vite plugin)
- First-class type safety for params, search params, and loader data
- Built-in search param validation with Zod/Valibot
- Automatic code splitting with file-based routing
- Pairs naturally with TanStack Query and TanStack Table

**Data fetching:** Neither includes data fetching. Pair with TanStack Query (recommended) or SWR.

**Bundle size:** Wouter is the absolute lightest option. TanStack Router is heavier but still lighter than React Router v7 when you factor in the type-safety features you would otherwise build manually.

**Migration effort:** **Low (Wouter) to Low-Medium (TanStack Router).** Wouter is a near drop-in replacement for the current `useState` approach -- just swap page state for URL paths. TanStack Router requires learning its route tree API but provides more structure in return.

**Community:** Wouter has a small but dedicated community; it is a niche library best suited for small projects. TanStack Router has a rapidly growing community, backed by the TanStack brand (which also maintains Query, Table, Virtual, and Form).

**Overkill factor:** **Not overkill at all.** This is the "add only what you need" approach.

---

## Comparison Matrix

| Criteria                    | 1. Vite + RR + TQ | 2. Next.js    | 3. RR7 Framework | 4. TanStack Start | 5a. Wouter    | 5b. TanStack Router |
|-----------------------------|-------------------|---------------|-------------------|-------------------|---------------|---------------------|
| **Routing overhead**        | ~11 kB            | ~80-100 kB    | ~15-20 kB         | ~12 kB            | ~2.2 kB       | ~12 kB              |
| **Type-safe routes**        | Partial           | Partial       | Yes (fw mode)     | Best-in-class     | No            | Best-in-class       |
| **File-based routing**      | No                | Yes           | Yes               | Yes (optional)    | No            | Yes (optional)      |
| **Auto code splitting**     | Manual            | Yes           | Yes               | Yes               | No            | Yes (file-based)    |
| **SSE/WS integration**      | Manual + TQ       | Manual + TQ   | Manual + TQ       | Manual + TQ       | Manual        | Manual + TQ         |
| **SPA mode**                | Native            | Awkward       | Limited           | Good              | Native        | Native              |
| **Migration effort**        | Low               | High          | Medium            | Medium-High       | Very Low      | Low-Medium          |
| **Stability (Mar 2026)**    | Stable            | Stable        | Stable            | RC (pre-1.0)      | Stable        | Stable (v1)         |
| **Community size**          | Largest           | Largest       | Large             | Growing           | Small         | Growing             |
| **Data table ecosystem**    | TanStack Table    | TanStack Table| TanStack Table    | Native TanStack   | TanStack Table| Native TanStack     |
| **Overkill for admin tool** | No                | Yes           | Somewhat          | Moderate          | No            | No                  |

---

## Analysis

### What we actually need

1. **URL-based routing** with deep links (`/sessions/:id`, `/agents/:id/logs`)
2. **Nested layouts** (sidebar + content, list + detail panels)
3. **Data fetching with caching** (polling, background refetch, stale-while-revalidate)
4. **Real-time integration** (SSE for agent output, WebSocket for commands)
5. **Type-safe params and search params** (filter state in URL)
6. **Code splitting** (dashboard has 6+ pages, will grow to 10+)
7. **Data tables** with sorting, filtering, pagination (TanStack Table)

### What we do NOT need

- Server-side rendering (internal tool behind auth)
- SEO optimization
- Static site generation
- Server Components
- Edge runtime deployment
- Server Actions / form mutations via server

### Eliminations

**Next.js (Option 2):** Eliminated. SSR-centric architecture adds complexity without value for a client-only admin dashboard. The framework overhead (~80-100 kB), server infrastructure requirements, and Vercel-oriented deployment model are all liabilities, not assets, for this use case.

**React Router v7 Framework Mode (Option 3):** Eliminated. The SPA mode limitations (loaders only on root route, no actions) undermine the main value proposition. If we are not using SSR, the loader/action pattern adds indirection without clear benefit over TanStack Query. Library mode (covered in Option 1) is viable, but framework mode is not the right fit.

**Wouter (Option 5a):** Eliminated. Too minimal for a growing dashboard. No nested layouts, no type-safe params, no code splitting, no search param management. We would outgrow it quickly and need to migrate again.

**TanStack Start (Option 4):** Deferred. The framework is not yet at v1.0 stable. The type safety and ecosystem integration are appealing, but adopting a pre-1.0 framework for production use is premature. Re-evaluate when v1.0 ships. If we choose Option 5b (TanStack Router), migrating to TanStack Start later will be straightforward because Start is built on Router.

### Remaining contenders

**Option 1: Vite + React Router v7 (library) + TanStack Query**
- Pros: Battle-tested stack, largest community, lowest migration risk, extensive documentation
- Cons: React Router v7 library mode has weaker type safety than TanStack Router; two separate libraries (RR for routing, TQ for data) that do not deeply integrate

**Option 5b: Vite + TanStack Router + TanStack Query**
- Pros: Best-in-class type safety, automatic code splitting, natural integration with TanStack Query and TanStack Table (which we will use for data tables anyway), search param validation built in, clear upgrade path to TanStack Start later
- Cons: Smaller community than React Router, newer (less Stack Overflow answers), requires learning a different route definition API

---

## Recommendation

**Option 5b: Vite + TanStack Router (v1, stable) + TanStack Query v5**

### Rationale

1. **Type safety is disproportionately valuable for dashboards.** A dashboard with many pages, URL params, search params (filters, sorting, pagination), and data dependencies benefits enormously from compile-time route type checking. TanStack Router's type safety is meaningfully better than React Router v7 in library mode.

2. **The TanStack ecosystem is our data layer anyway.** We will almost certainly use TanStack Table for data tables (it is the standard for headless React tables). TanStack Query is the leading data-fetching library. Using TanStack Router means all three libraries share conventions, documentation patterns, and release cadence. There is reduced cognitive overhead from staying within one ecosystem.

3. **File-based routing with automatic code splitting is free performance.** With 6+ pages today and likely 10-15 pages at maturity, automatic code splitting ensures each page only loads what it needs. This comes for free with TanStack Router's file-based routing + Vite plugin.

4. **Search param management is a killer feature for dashboards.** TanStack Router has first-class, type-safe, validated search params with Zod/Valibot integration. For a dashboard where every table needs filter/sort/page state preserved in the URL, this eliminates an entire class of bugs and boilerplate.

5. **Clear upgrade path.** If TanStack Start reaches v1.0 and we decide we want server functions or SSR later, the migration from TanStack Router to TanStack Start is minimal (Start is built on Router). We are not painting ourselves into a corner.

6. **SPA-native.** TanStack Router was designed as a client-side router first. There is no "SPA mode" with limitations -- SPA is the default mode. No server infrastructure needed.

7. **Stable.** TanStack Router v1 is stable and production-ready. Unlike TanStack Start (RC), the router itself has been through multiple stable releases.

### Additional libraries for the stack

| Library              | Purpose                         | Size (gzipped) |
|----------------------|---------------------------------|-----------------|
| TanStack Router v1   | Routing, layouts, params        | ~12 kB          |
| TanStack Query v5    | Data fetching, caching, polling | ~13 kB          |
| TanStack Table v8    | Headless data tables            | ~14 kB          |
| Tailwind CSS v4      | Utility-first styling           | 0 kB runtime    |
| shadcn/ui            | Component primitives (copy-paste, not a dependency) | varies |
| Sonner               | Toast notifications             | ~4 kB           |

**Total routing + data layer overhead:** ~39 kB gzipped (Router + Query + Table), which is less than Next.js's framework baseline alone.

### Migration plan (high level)

1. Add TanStack Router, TanStack Query, and Vite plugin to `packages/web`
2. Define route tree (file-based or code-based, can start with code-based and migrate later)
3. Replace `App.tsx` useState-based page switching with `<RouterProvider>`
4. Migrate pages one at a time: add route file, wrap data fetching in `useQuery`, add search param schemas
5. Replace custom `use-polling` hook with TanStack Query's `refetchInterval`
6. Integrate WebSocket hook with `queryClient.setQueryData()` for real-time cache updates
7. Add Tailwind + shadcn/ui incrementally, replacing inline styles page by page
8. Add TanStack Table for data-heavy pages (Sessions, Agents, Machines, Logs)

This can be done incrementally without a big-bang rewrite. Each step is independently deployable.

---

## Sources

- [TanStack Start v1 Release Candidate announcement](https://tanstack.com/blog/announcing-tanstack-start-v1)
- [TanStack Start overview and comparison](https://tanstack.com/start/latest/docs/framework/react/comparison)
- [TanStack Router file-based routing](https://tanstack.com/router/v1/docs/framework/react/routing/file-based-routing)
- [TanStack Router automatic code splitting](https://tanstack.com/router/v1/docs/framework/react/guide/automatic-code-splitting)
- [TanStack Start SPA mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode)
- [React Router v7 SPA mode](https://reactrouter.com/how-to/spa)
- [React Router v7 modes](https://reactrouter.com/start/modes)
- [TanStack Router vs React Router comparison](https://betterstack.com/community/comparisons/tanstack-router-vs-react-router/)
- [TanStack Query and WebSockets integration](https://blog.logrocket.com/tanstack-query-websockets-real-time-react-data-fetching/)
- [Vite vs Next.js for React developers 2026](https://designrevision.com/blog/vite-vs-nextjs)
- [Next.js vs Vite: choosing the right tool in 2026](https://dev.to/shadcndeck_dev/nextjs-vs-vite-choosing-the-right-tool-in-2026-38hp)
- [TanStack Router vs React Router v7 comparison (Jan 2026)](https://medium.com/ekino-france/tanstack-router-vs-react-router-v7-32dddc4fcd58)
- [React frameworks in 2026: Next.js vs Remix vs React Router 7](https://medium.com/@pallavilodhi08/react-frameworks-in-2026-next-js-vs-remix-vs-react-router-7-b18bcbae5b26)
- [Wouter: minimalist React router (~2.2 kB)](https://github.com/molefrog/wouter)
- [shadcn/ui dashboard guide 2026](https://designrevision.com/blog/shadcn-dashboard-tutorial)
- [React Router v7 library vs framework mode](https://blog.logrocket.com/react-router-v7-modes/)
- [TanStack ecosystem complete guide 2026](https://www.codewithseb.com/blog/tanstack-ecosystem-complete-guide-2026)
- [Stop the hype: facts before leaving Next.js in 2026](https://www.holgerscode.com/blog/2026/01/30/stop-the-hype-lets-look-at-the-facts-before-leaving-nextjs-in-2026/)
