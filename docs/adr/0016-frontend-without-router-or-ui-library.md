# 0016. Frontend without a router or UI library, under a strict CSP

- Status: Accepted
- Date: 2026-10-22

## Context

The SPA is small: a mobile-first user app and an admin panel. CloudFront serves it with a strict CSP (`default-src 'self'`), which blocks Google Fonts, CDNs and `data:` URLs. The visual redesign follows a dark design system.

## Decision

- No router library: `apps/web/src/main.tsx` switches on `location.pathname`, and navigation is full-page.
- No UI component library: native `<dialog>` and `<select>`, with small components in `apps/web/src/ui`.
- Tailwind v4 with `@theme` tokens, dark theme only.
- Fonts are self-hosted through `@fontsource-variable` packages, so the CSP stays unchanged. Icons come from `lucide-react`.
- The admin panel is a lazy-loaded chunk under `/admin`.

Reason: the app is small, and fewer dependencies are enough.

## Consequences

- New pages need a branch in `main.tsx` and full-page links.
- Any external asset must be bundled; the CSP does not change for the UI.
- E2E tests select by text and role. Labels, button names, roles and exact strings must survive UI changes ([development.md](../development.md)).
