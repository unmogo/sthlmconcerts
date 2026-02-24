# Process: UI & Design Conventions

## Design System
- All colors via CSS custom properties in `index.css` (HSL format)
- Never use raw color classes (`text-white`, `bg-black`) — use semantic tokens
- Tokens: `--background`, `--foreground`, `--primary`, `--muted`, `--accent`, `--destructive`

## Component Patterns
- Use shadcn/ui components as base, extend with variants
- Keep components small and focused (< 150 lines)
- Colocate types with components unless shared

## Layout
- `container` class for max-width centering
- Sticky header with blur backdrop
- Card-based grid for concert listings
- Responsive: mobile-first, breakpoints at `sm`, `md`, `lg`

## Icons
- Use `lucide-react` exclusively
- Size: `h-4 w-4` for inline, `h-5 w-5` for header

## State Management
- Server state: TanStack Query (`useQuery`, `useMutation`)
- UI state: React `useState` / `useCallback`
- Auth state: `AuthContext` provider

## Admin vs User
- Admin features gated behind `isAdmin` from `useAuth()`
- Admin-only: Add, Delete, Export, Scrape, Fetch Images
- User features: Browse, Search, Filter, Favorites (requires sign-in)
