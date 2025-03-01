# Ley-Star Project Structure

## Planned Structure
```
ley-star.deploy/
├── src/                      # Project source code
│   ├── api/                  # Express API code
│   │   └── index.js          # API routes and logic
│   ├── frontend/             # SvelteKit app
│   │   ├── app.html          # SvelteKit app shell
│   │   ├── app.css           # Global styles
│   │   ├── lib/              # Shared code for client and server
│   │   │   ├── components/   # Reusable Svelte components
│   │   │   │   ├── Banner.svelte
│   │   │   │   ├── ManuscriptViewer.svelte
│   │   │   │   ├── PageNavigator.svelte
│   │   │   │   └── ...
│   │   │   ├── utils/        # Helper functions
│   │   │   └── types.js      # JS with JSDoc for type hints (optional)
│   │   ├── routes/           # SvelteKit routes
│   │   │   ├── +layout.svelte # Main layout
│   │   │   ├── +page.svelte  # Homepage
│   │   │   ├── manuscripts/  # Manuscript routes
│   │   │   │   ├── +page.svelte # Manuscript listing
│   │   │   │   └── [id]/     # Individual manuscript
│   │   │   │       ├── +page.svelte
│   │   │   │       └── pages/[pageNum]/+page.svelte
│   │   ├── static/           # Static assets (images, favicon, etc.)
│   │   ├── svelte.config.js  # SvelteKit config
│   │   └── vite.config.js    # Vite config
├── server.js                 # Combined server entry point
└── package.json              # Dependencies for both
```

## Component Structure

### Main Components
- **Banner.svelte**: Navigation header with site branding
- **ManuscriptList.svelte**: Grid/list view of available manuscripts
- **ManuscriptViewer.svelte**: Main viewer for a single manuscript
- **PageNavigator.svelte**: Interface for navigating between pages
- **TranscriptView.svelte**: Display transcript data with features

### Page Routes
- **/** - Homepage with featured manuscripts
- **/manuscripts** - Browse all manuscripts
- **/manuscripts/[id]** - View a specific manuscript
- **/manuscripts/[id]/pages/[pageNum]** - View a specific page

## API Integration
- Frontend components will fetch data from the Express API
- API endpoints are mounted at `/api/...`
- All manuscript data comes from Google Cloud Storage

## Data Flow
1. User navigates to a route
2. SvelteKit loads the appropriate component
3. Component requests data from API endpoints
4. API retrieves data from Google Cloud Storage
5. Component renders the data with appropriate UI

## Styling Approach
- Global styles in app.css
- Component-specific styles using Svelte's scoped styling
- Responsive design for all screen sizes