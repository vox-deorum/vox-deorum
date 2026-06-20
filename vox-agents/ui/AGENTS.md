# AGENTS.md - Vox Agents UI

Vue 3 + TypeScript UI. Follow existing patterns, don't reinvent.

## Core Principles

### Look Before You Leap
- **Check existing components** in `components/` before creating new ones
- **Review existing styles** in `styles/` (global, panel, states, data-table, civ5-theme)
- **Use existing stores** in `stores/` for state management patterns
- **Import types** from `@/utils/types` which re-exports backend types

### Type Safety
```typescript
// All types come from one place
import type { VoxContext, ToolCall, AIMessage } from '@/utils/types';

// Never use any or unknown
// Always use defineProps<T>() and defineEmits<T>()
```

### PrimeVue First
- Use PrimeVue components and PrimeFlex utilities
- Check [PrimeVue docs](https://primevue.org) before custom solutions
- Prefer component props over custom CSS
- Use theme CSS variables for consistency
- **Design tokens**: Use `--p-content-*` for data displays (tables, panels), avoid `--p-surface-*` for UI elements
- **Spacing**: Avoid excessive padding/margins - prefer compact layouts using existing stylesheet spacing

### State Patterns
- **Stores**: Reactive refs exported directly (see `stores/health.ts`)
- **SSE**: Auto-reconnect with exponential backoff (see `stores/logs.ts`)
- **API**: Centralized client with typed responses (see `api/client.ts`)

## Shared Style Classes

**IMPORTANT**: Always reuse existing styles from `src/styles/` rather than creating duplicates.

### Available Stylesheets
- `global.css` — `.section-container` (card sections with gap), `.section-header` (card title with icon)
- `data-table.css` — `.data-table`, `.table-header`, `.table-body`, `.table-row`, `.table-empty`, `.col-fixed-{50-250}`, `.col-expand`, `.text-truncate`, `.text-wrap`, `.text-muted`, `.text-small`
- `chat.css` — Chat message and interface styles
- `states.css` — `.loading-container`, `.error-container`, `.empty-state`

### Rules
1. Check all shared stylesheets before creating any new styles
2. Use `.table-empty` for all empty states
3. Use `.section-container` for views with multiple card sections
4. If you must create a new style, add it to shared styles first — avoid splintered styles across components

## PrimeVue Color System

**IMPORTANT**: Always use PrimeVue 4's actual CSS variables, not guessed names.

### Core Variables
| Variable | Purpose |
|----------|---------|
| `--p-text-color` | Primary text |
| `--p-text-muted-color` | Secondary/muted text |
| `--p-text-hover-color` | Text hover state |
| `--p-primary-color` | Theme primary (amber) |
| `--p-primary-contrast-color` | Text on primary background |
| `--p-highlight-background` | Highlighted element background |
| `--p-highlight-color` | Highlighted element text |

### Content Backgrounds
**Use `--p-content-*` for content areas** — they adapt to dark mode:
- `--p-content-background` — Main content area
- `--p-content-hover-background` — Hovered content
- `--p-content-border-color` — Content borders
- `--p-hover-background` — General hover state

**DO NOT use `--p-surface-0` for content backgrounds** — it stays white in dark mode!

### Surface System
`--p-surface-{0-950}` scale for UI layers (not content):
- `0` pure white, `50` lightest gray, `100`/`200` light grays, `900` dark gray

### Color Palette
All colors available as `--p-{color}-{50-950}`:
amber, blue, red, green, yellow, orange, slate, gray, zinc, neutral, stone, cyan, teal, emerald, lime, purple, violet, indigo, sky, pink, rose, fuchsia

### Dark Mode
Use `:root[data-theme="dark"]` selector for dark mode overrides:
```css
:root[data-theme="dark"] .message {
  background: var(--p-surface-900);
}
```

### Usage Examples
```css
/* Correct */
.log-header {
  background: var(--p-content-hover-background);
  color: var(--p-text-color);
  border: 1px solid var(--p-content-border-color);
}

.content-panel {
  background: var(--p-content-background);
}

.log-error {
  color: var(--p-red-700);
  background: var(--p-red-50);
}

/* Incorrect - these don't exist */
/* var(--p-surface-hover) - use specific surface values */
/* var(--p-surface-border) - use var(--p-content-border-color) */
/* var(--vp-c-*) - VitePress variables, not PrimeVue */
```

### Chat Styles
Message type colors:
- User: `--p-primary-50` bg, `--p-primary-500` border
- Assistant: default surface colors
- System: muted colors, italic text, `--p-gray-500` border
- Tool: subtle surface with `--p-purple-500` label color

Dark mode shadows: use `rgba(0, 0, 0, 0.4)` instead of theme shadow variables.

## Component Patterns

### Loading/Error/Empty States
```vue
<!-- Use existing CSS classes from styles/states.css -->
<div v-if="loading" class="loading-container">
  <i class="pi pi-spin pi-spinner" style="font-size: 2rem;" />
  <p>Loading...</p>
</div>

<div v-else-if="error" class="error-container">
  <i class="pi pi-exclamation-triangle" />
  <p>{{ error }}</p>
</div>

<div v-else-if="!data.length" class="empty-state">
  <i class="pi pi-inbox" />
  <p>No data available</p>
</div>
```

### Polling & Real-Time Data
```vue
<script setup>
// Poll data while dialog is visible
const dialogVisible = ref(false);
let pollInterval = null;

watch(dialogVisible, (visible) => {
  if (visible) {
    loadData();
    pollInterval = setInterval(loadData, 60000); // 60s
  } else {
    if (pollInterval) clearInterval(pollInterval);
  }
});

// Always cleanup on unmount
onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval);
});
</script>
```

### Real Examples to Follow
- **LogViewer.vue** - SSE streaming, filtering, virtual scroll
- **DashboardView.vue** - Cards, health monitoring, state patterns
- **TelemetryView.vue** - DataTable with pagination, trace navigation
- **ConfigView.vue** - Forms, validation, JSON editing
- **AIMessagesViewer.vue** - Message rendering, tool calls display

## File Structure
```
src/
├── api/          # API client, SSE utils
├── components/   # Reusable Vue components
├── stores/       # Reactive state management
├── styles/       # Global CSS, theme overrides
├── utils/        # Type definitions, helpers
└── views/        # Route-level components
```

## Performance Guidelines
- Virtual scroll for lists > 100 items
- Debounce search inputs (300ms)
- Buffer limits: 1000 logs, 100 telemetry spans
- Lazy load routes with `() => import()`

## Integration
- Backend types via `@/utils/types`
- Winston logs via SSE (`stores/logs.ts`)
- Config from `config.json` via API
- Telemetry SQLite via Kysely

## Data Display Patterns

### Backend/Frontend Separation
- **Backend**: Send complete data structures without pre-formatting
- **Frontend**: Handle formatting, filtering, sorting for display
- Example: Backend returns full `PlayersReport`, frontend filters to major players and formats values

## Commands
```bash
cd vox-agents/ui
npm run dev           # Dev server with HMR
npm run type-check    # Project-wide type-check (vue-tsc --build) — covers src AND tests
npm run build         # Production build to ../dist-ui/ (runs type-check first)

cd vox-agents
npm run webui:dev     # Backend + frontend together
```

**Type-checking gate**: always verify with `npm run type-check` before considering UI changes
done. It runs `vue-tsc --build`, which follows the project references and checks `tests/` too.
Do **not** rely on a bare `vue-tsc --noEmit` — it can pass while the build fails, because it
skips the test files (test-only errors like `Array.at` or implicit `any` in callbacks only
surface in the `--build` check).

## Don'ts
- Don't use `any` or `unknown` types
- Don't create styles when PrimeFlex has it
- Don't poll when SSE is available
- Don't hardcode URLs or magic numbers
- Don't skip error handling
- Don't mutate props, use emits
- Don't fetch in templates
- Don't use monospace fonts (except code display)
- Don't use `--p-surface-0` for content backgrounds — use `--p-content-background`
- Don't hardcode colors like `rgba(0,0,0,0.15)` — use PrimeVue theme variables

## When Adding Features
1. Check PrimeVue catalog first
2. Look at existing components for patterns (especially similar ones)
3. Use types from `@/utils/types`
4. Use existing CSS classes from `styles/` - minimize component-specific styles
5. Sort data by stable identifiers (IDs) for predictable ordering
6. Backend sends full data, frontend formats and filters for display
7. Handle loading, error, and empty states
8. Test with real game data
