# Voyager App Design Guidelines

This document defines the default design rules for the Voyager app experience.

Scope:
- Applies to the authenticated app and all in-app workspaces.
- Does not constrain the marketing / landing pages, which may use a broader visual language.

Goal:
- Build a calm, useful, restrained product UI.
- Prefer clarity, hierarchy, and speed over visual decoration.
- Remove interface text and components that do not help the user make a decision or complete a task.

## 1. Product Direction

Voyager app UI should feel:
- quiet
- practical
- premium through restraint, not ornament
- dense enough to be productive, never cramped

Avoid:
- decorative gradients in the app shell
- oversized radii
- floating glassmorphism as the default
- duplicated labels, repeated summaries, or meta copy with no decision value
- strong animation or blur in dense app surfaces

## 2. Core Principles

1. Every element must earn its place.
2. Information hierarchy is more important than visual novelty.
3. Navigation should explain where the user is and what they can do next.
4. Repetition is only acceptable when it improves orientation.
5. The shell should stay quieter than the page content.

## 3. Color System

Use a restrained neutral-first palette.

Base colors:
- App background: `#F3F5F7`
- Main surface: `#FFFFFF`
- Secondary surface: `#F7F8FA`
- Primary text: `#1A1615`
- Secondary text: `#5F6B7A`
- Tertiary text / labels: `#8B94A3`
- Border: `rgba(0, 0, 0, 0.08)`
- Strong border: `rgba(0, 0, 0, 0.12)`
- Primary action / CTA: `#1A1615`
- Primary action text: `#FFFFFF`

Accent usage:
- Blue is informational, not decorative.
- Use blue only for:
  - selected states when needed
  - informative badges
  - map-specific UI
  - status cues that genuinely benefit from color

Avoid:
- blue ambient backgrounds behind app screens
- colorful panels unless they encode state
- multiple accent colors in the same local UI cluster

## 4. Typography

Default rule:
- One type family across the product UI is preferred.
- Use display treatments rarely.

Current app default:
- `Outfit`

Weight rules:
- `400` for body and nav labels
- `500` for section titles, active nav items, buttons
- `600` only for strong emphasis
- avoid `700+` in routine app UI

Case rules:
- Sentence case by default
- Uppercase only for very small labels or data-eyebrows
- Avoid wide tracking on routine UI labels

Size guidance:
- App shell title: `16px`
- Section labels / muted labels: `11-12px`
- Navigation items: `14-15px`
- Body copy: `14-16px`
- Card titles: `16-20px`

Avoid:
- decorative subheadings in the shell
- duplicate title + subtitle + meta stack when one line is enough

## 5. Radius Rules

Radius must stay controlled.

Default radius scale:
- shell wrapper: `10-12px`
- cards / panels: `12-16px`
- buttons and inputs: `8-10px`
- small controls: `8px`
- avatar tiles: `10-12px`
- pills and badges: fully rounded only when the component is actually a pill

Hard rule:
- Do not exceed `16px` radius in the app UI unless the component is intentionally circular.

Avoid:
- `24px+` radii in the app shell
- mixing many radius sizes in a single surface

## 6. Spacing System

Use a small consistent scale:
- `4`
- `8`
- `12`
- `16`
- `24`
- `32`

Default spacing rules:
- Dense rows: `8px`
- Standard control padding: `8px 12px`
- Card padding: `16px`
- Section gaps inside workspaces: `16px` or `24px`
- Shell edge gutter: `8px` to `12px`

Avoid:
- arbitrary one-off spacing values
- large empty regions in navigation
- oversized shell padding that competes with page content

## 7. App Shell Layout

The shell is infrastructure, not the main attraction.

Desktop shell:
- Left sidebar width: `232-248px`
- Top shell header height: `44-48px`
- Content wrapper radius: `10-12px`
- Content wrapper border: `1px`, subtle
- Outer shell margin: `8-12px`

Sidebar structure:
1. Brand row
2. Primary action
3. Primary navigation
4. One contextual block only
5. Account row

Contextual block rule:
- Before a trip is open: show a small recent trips block
- Show that block only on trip-browsing screens where it helps navigation
- Hide it on create, edit, onboarding, auth, or other task-focused flows
- Inside a trip: show current trip navigation
- Do not show both at full size in the same sidebar state

Brand rule:
- Logo and title must read as one component
- Keep it one row or one compact block
- No decorative subcopy unless it adds orientation value

Header rule:
- Show only the page title by default
- Controls live on the top right
- The shell header owns page-level actions, pagination, and lightweight filters
- If the shell already exposes an action or count, do not repeat it in the page body
- No extra eyebrow like "Voyager workspace" unless it serves a real navigation need

## 8. Pagination

Pagination should be integrated into list pages and their shell header.

Rules:
- Put pagination controls in the top-right shell header for paged index screens
- Keep controls compact
- Show:
  - current page
  - total pages
  - previous / next controls
  - optional item range if helpful
- Page-specific primary actions may sit next to pagination in the same top-right cluster

Do not:
- duplicate pagination at both top and bottom by default
- expose pagination controls on detail pages
- split related page controls between shell header and page body

## 9. Content Surface Rules

Page content wrappers should be simpler than cards within them.

Rules:
- White or near-white surface
- Minimal border
- No heavy shadow by default
- No strong blur by default
- Page spacing should come from layout structure, not giant panel padding
- The shell inset is already the primary frame; do not place a second giant all-page card inside by default
- Use one dominant container layer per page state unless a second layer adds real structure

Shell vs page rule:
- The shell stays visually quieter than the workspace content
- Cards, tables, planners, and maps can carry stronger hierarchy than the shell

Container rules:
- Prefer sections over wrappers-over-wrappers
- Avoid page -> large card -> inner cards unless each layer has a clear job
- Use containers to group tasks, not to decorate empty space

Layout proportion rules:
- Wide screens should use width intentionally, not stretch one generic blob across the page
- Lists should adapt with responsive grids or columns that match card density
- Forms should split into logical panels when screen width allows
- Sidebar, shell header, and page body should read as one system with aligned edges

## 10. Interaction Rules

Motion should feel fast and quiet.

Default interaction timing:
- hover: `120-180ms`
- open/close: `150-220ms`

Hover rules:
- In dense shell UI, hover should mostly change color, not geometry
- Avoid hover transforms on shell buttons and nav rows
- Avoid shadow flicker on primary actions

Focus rules:
- Every interactive control needs a visible focus state
- Focus rings should be subtle but obvious

Disabled rules:
- Lower contrast, no confusing hover behavior

Avoid:
- hover lift on small shell controls
- blur-heavy animated sheets
- long slide animations on mobile nav

## 11. Mobile Rules

Mobile shell must be simpler than desktop, not a compressed version of it.

Rules:
- Sidebar becomes a fast sheet
- Keep motion short and direct
- Reduce blur and shadow on mobile overlays
- Avoid long lists in the mobile navigation
- Keep touch targets at least `40px`
- Do not duplicate page title, shell title, and section title in the same viewport

Mobile sidebar content:
- brand
- primary action
- primary navigation
- one small contextual block
- account row

If the contextual block becomes too long:
- collapse it
- shorten it
- or move it into the page body

Scrollbar rule:
- Keep scrolling behavior, but hide visible scrollbars in app chrome and content surfaces unless a scrollbar is required for a specialist tool
- The page itself must not scroll; only the intended inner content area may scroll

## 12. Navigation Content Rules

Navigation is for orientation and action, not storytelling.

Allowed text in nav:
- current location
- nearby destinations
- recent items
- counts only when they change user decisions

Do not show:
- marketing-style descriptions
- generic summaries like "keep everything in one place"
- metadata that is already visible on the active page
- multiple labels that describe the same area

Recent items rule:
- max 3 in sidebar
- title only by default
- add one secondary line only if it materially improves recognition

## 13. Copy Rules

Every text string must do one of these:
- orient the user
- explain state
- support a decision
- support an action
- reduce ambiguity

If a text does not do one of those, remove it.

Use:
- short labels
- plain language
- direct verbs

Avoid:
- decorative copy in the shell
- filler phrases
- repeating the same noun in nearby labels
- internal product language that users do not need
- repeating shell title, page title, and section title when one is enough

Index page rule:
- Show the primary collection early
- Do not place dashboard-style metric blocks ahead of the core list unless they change the next decision
- Counts, coverage summaries, and status tiles must justify the space they take

Form page rule:
- Put submit actions in one primary place
- Do not repeat the same action in both shell and body unless the page is very long and the user would otherwise lose access

## 14. Component Defaults

Buttons:
- height `34-40px`
- radius `8-10px`
- use one strong primary button per local cluster

Inputs:
- height `36-40px`
- quiet border
- no oversized rounding

Cards:
- padding `16px`
- radius `12-16px`
- border before shadow

Dropdowns / menus:
- radius `10-14px`
- minimal shadow
- compact line height

Tables:
- prioritize alignment and legibility
- avoid decorative empty states

## 15. Do / Do Not

Do:
- use one compact spacing scale
- keep shell typography understated
- use contrast to guide focus
- let content areas carry the complexity

Do not:
- stack multiple informational blocks in the sidebar
- overuse uppercase labels
- use giant radii in app chrome
- add copy that merely sounds nice
- use motion to disguise layout problems

## 16. Review Checklist

Before shipping any app UI:

- Is every visible text string useful?
- Is the shell quieter than the page content?
- Are radii within the defined scale?
- Are spacing values coming from the approved scale?
- Is there only one contextual block in the sidebar?
- Does mobile remove complexity instead of compressing it?
- Are top-right controls reserved for page-level actions like pagination, filters, or view mode?
- Are hover states calm and free of flicker?

## 17. Implementation Priority

When updating existing screens, fix in this order:

1. remove useless text
2. simplify layout structure
3. normalize spacing
4. normalize radii
5. normalize typography
6. reduce decorative color and motion

This order matters. A cleaner structure beats a prettier surface.
