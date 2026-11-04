# Apple HIG-Inspired Design Guide for PairPocket (design.md)

## 1. Core Principles
* **Minimalism & Clarity:** Minimize unnecessary decorations and borders. Use spacing, subtle shadows, and typography to establish visual hierarchy.
* **Consistent Cross-Platform Experience:** Guarantee the exact same UI across iOS, Android, and Desktop by using the 'Pretendard' web font.
* **Native Feel:** Utilize glassmorphism (blur effects) and smooth rounded corners (squircles) to mimic a native application.
* **Perfect Dark Mode:** Every component must fully support both light and dark modes using Tailwind's `dark:` variant.

## 2. Typography & Text Control
* **Primary Font:** Strictly use the **'Pretendard'** web font to prevent layout shifts and inconsistent line heights across different devices.
* **Tailwind Configuration:** `font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif;`
* **Text Overflow Management (Crucial):** To prevent UI breakage on smaller screens, apply the following Tailwind utility classes for single-line text areas (like transaction names or amounts):
  * `whitespace-nowrap`: Prevents text from wrapping to the next line.
  * `truncate`: Adds an ellipsis (...) when the text exceeds the container width.
* **Large Title (iOS Style Header):** Place a large, bold title at the top left of the page.
  * *Classes:* `text-3xl font-bold tracking-tight text-gray-900 dark:text-white`
* **Body Text:** Maintain adequate line height for readability.
  * *Classes:* `text-base text-gray-700 dark:text-gray-300`

## 3. Layout & Responsive Structure
* **Mobile Environment (`< md`):**
  * Display a fixed Bottom Tab Bar to navigate main menus (Shared, Personal, Stats).
  * Apply a translucent blur effect to the tab bar.
* **Tablet & Desktop Environment (`>= md`):**
  * Hide the Bottom Tab Bar and display a fixed Sidebar on the left (similar to macOS Finder or iPad Settings).
  * Center the main content area with max-width and side padding to prevent it from stretching too far.

## 4. Core Component Styles

### A. Inset Grouped Lists
Group lists (like transaction histories or settings) inside rounded cards with side margins, rather than full-width lines.
* **Card Background:** `bg-white dark:bg-gray-800 rounded-2xl shadow-sm`
* **List Item Dividers:** Use very faint dividers between items, starting from the text alignment. 
  * *Classes:* `divide-y divide-gray-100 dark:divide-gray-700`

### B. Glassmorphism (Translucency)
Make the top header (navigation bar) and bottom tab bar translucent so content scrolls behind them subtly.
* **Header & Tab Bar Classes:** `bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-200/50 dark:border-gray-800/50 sticky top-0 z-50`

### C. Buttons, Inputs & Squircles
Apply smooth, rounded corners to all interactive elements.
* **Primary Action Button:** Use the signature tint color (System Blue).
  * *Classes:* `bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white font-semibold rounded-xl px-4 py-3 transition-colors`
* **Inputs & Selects:** Remove default borders and add a soft focus ring.
  * *Classes:* `bg-gray-50 dark:bg-gray-900 border-0 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500`

## 5. PWA (Progressive Web App) Meta Tags
Include these tags in the HTML `<head>` to ensure a native-like full-screen experience on mobile devices.
* `<meta name="apple-mobile-web-app-capable" content="yes" />`
* `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`
* `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />` (Pinch-to-zoom stays available; never set `maximum-scale` or `user-scalable=no`)
* **Inputs are at least 16px on mobile.** iOS zooms in when a field under 16px gets focus, so every input, textarea and select uses `text-base` below `sm` and may drop to its denser size above it (for example `text-base sm:text-sm`). `.input-field` does this by default.

## 6. Color Palette
* **App Background:** `bg-gray-50 dark:bg-black`
* **Surface (Cards/Modals):** `bg-white dark:bg-gray-900`
* **Primary Accent:** `text-blue-500` (Apple System Blue)
* **Destructive/Warning:** `text-red-500` (Apple System Red)
* **Text Hierarchy:** Primary text is `text-gray-900 dark:text-white`. Secondary text (captions, form labels, timestamps, inactive tabs, meaningful icons, placeholders) is `text-gray-500 dark:text-gray-400`, which keeps at least 4.5:1 on white, gray-50, gray-800 and gray-900. Do not use `text-gray-400` or lighter for text in light mode, or `dark:text-gray-500` or darker in dark mode. Hover states go one step darker in light mode (`hover:text-gray-700`) and one step lighter in dark mode. Only disabled controls may be lighter.
* **Chart Colors:** Category colors come from the mid-tone set in `components/DashboardAnalytics.tsx`. Every chart color must reach at least 3:1 against both white and the gray-800/900 dark cards, and neighboring series must stay easy to tell apart. Do not add white, near-white or near-black swatches.
* **Currency Distinction (Optional):** Use subtle visual cues (like different soft background tints or icons) to differentiate CAD and KRW transactions.