# Code Review design

The Code Review home uses the AgentsKit homepage as its visual source of truth. Keep the shared dark foundation, calm type, ambient liquid background, and restrained glass surfaces. Product identity comes from the review workflow and evidence shown in the demo, not a separate color system.

## Tokens

Use the AgentsKit palette already exposed by `apps/docs/app/brand-tokens.css` and the home aliases in `apps/docs/app/globals.css`:

| Role | Token |
|---|---|
| Page | `--ak-bg` (`#0D1117`) |
| Surface | `--ak-surface` (`#161B22`) |
| Border | `--ak-border` (`#30363D`) |
| Primary text | `--ak-fg` (`#E6EDF3`) |
| Secondary text | `--ak-muted` (`#8B949E`) |
| Links, focus, labels | `--ak-blue` (`#58A6FF`) |
| Positive diff lines | `--ak-green` (`#2EA043`) |
| High severity | `--ak-red` (`#F85149`) |

Avoid adding product-specific accent colors or competing gradients. Severity remains explicit in text and uses semantic red only where appropriate.

## Typography and layout

- The homepage uses Inter for headings and body copy, matching AgentsKit’s current Apple-influenced home treatment.
- Use JetBrains Mono only for code, paths, metadata, and concise technical labels.
- Use tight display tracking, comfortable body line-height, open section spacing, and one consistent content width.
- Keep the hero explanation and live review demo as the primary hierarchy. Follow it with configuration controls, provider compatibility, and local/CI run paths.

## Background, glass, and borders

- Keep the homepage on the shared midnight base with low-opacity blue and green radial light across the full page.
- The liquid pointer effect is a soft extension of that ambient light. Keep it home-only, pointer-only, and disabled for touch and reduced motion.
- Reserve glass for the header, review demo, configuration/run panels, and footer. Use translucent dark surfaces, subtle blur, and a faint border.
- Keep code and review findings on solid, legible surfaces. Do not nest decorative cards or add repeated panels around copy.
- Separate the configuration, provider, and delivery sections with whitespace and background flow; keep their outer edges borderless. Borders belong to the inner interactive panels and controls.
- Use 24 px corners for the main demo, pill corners for primary actions and tabs, and compact radii for dense code surfaces.

## Motion and interaction

- Use short, quiet transitions for focus changes and tab selection. The review example advances between findings and can be paused.
- Security, Code quality, Performance, and Correctness tabs stay keyboard-operable, expose `aria-selected`, and update the associated example panel.
- The provider rail moves continuously with CSS, pauses on hover/focus, and becomes a static wrapping list for reduced motion.
- The provider rail uses pinned LobeHub static SVG marks with visible text labels; never substitute initials or an unrelated brand mark for a missing logo. This is an asset source, not an installed UI dependency.
- Highlight code examples by token with lightweight spans while preserving copyable plain text and horizontal scrolling inside code blocks.
- Configuration controls update a real supported config excerpt. Run-mode controls switch between the documented CLI and GitHub Action examples.
- Respect `prefers-reduced-motion`; the pointer light and panel entrance are disabled.
- Focus uses the shared AgentsKit blue and remains visible against translucent surfaces.

## Responsive behavior and accessibility

- Stack the hero explanation before the demo on narrow viewports. Stack diff and finding vertically while preserving readable code through an internal horizontal scroller.
- Prevent page-level horizontal overflow and keep navigation usable at narrow widths.
- Keep secondary copy readable over the ambient background; the pointer effect must not lower text contrast.
- Pair severity and diff color with visible labels or symbols. Maintain keyboard focus and semantic headings.
- Provider logos are decorative and names remain visible as text. Use correct provider marks; do not show a monogram as a logo fallback.
- At compact widths, stack the configuration and delivery panels under their explanatory copy. Wrap or stack optional review lens controls before their labels can overflow.
- State that the broad AgentsKit catalog and Code Review compatibility list have different scopes; never imply every catalog integration is a Code Review provider.

## Reuse boundaries

- The ecosystem bar is the current AgentsKit script mirrored into this app's `public/` directory for deployment. Keep the copy byte-for-byte aligned with its source; do not fork or product-style it here.
- Reuse the existing lightweight cursor implementation; do not add an animation dependency.
- Keep Fumadocs interior pages calm and solid. Home-only ambient light and glass must not bleed into documentation routes.
