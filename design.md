# Ley-Star Project Structure

## Current Structure
```
ley-star.deploy/
├── src/                      # Project source code
│   ├── api/                  # Express API code
│   │   ├── index.js          # API routes and logic
│   │   └── index-search.ts   # Manuscript search implementation
│   ├── frontend/             # Svelte app
│   │   ├── lib/              # Shared code for client
│   │   │   ├── components/   # Reusable Svelte components
│   │   │   └── stores.js     # Svelte stores
│   │   ├── routes/           # Svelte routes
│   │   │   ├── +layout.svelte # Main layout
│   │   │   ├── +page.svelte  # Homepage
│   │   │   ├── manuscripts/  # Manuscript routes
│   │   │   │   ├── +page.svelte # Manuscript listing with search/filters
│   │   │   │   └── [id]/     # Individual manuscript
│   │   ├── static/           # Static assets (images, favicon, etc.)
│   │   ├── svelte.config.js  # Svelte config
│   │   └── vite.config.js    # Vite config
├── scripts/                  # Utility scripts
│   ├── index_manuscripts.py  # Script to create search index
├── server.js                 # Combined server entry point
└── package.json              # Dependencies for both
```

## Component Structure

### Main Components
- **Manuscript List Page**: Tabular view of manuscripts with search, filter, sort
- **ManuscriptViewer**: Main viewer for a single manuscript
- **PageNavigator**: Interface for navigating between pages

### Page Routes
- **/** - Homepage redirects to manuscripts
- **/manuscripts** - Browse/search all manuscripts
- **/manuscripts/[id]** - View a specific manuscript
- **/manuscripts/[id]/pages/[pageNum]** - View a specific page

## Search and Filter Features
- Client-side search implementation for manuscript data
- Advanced boolean faceted filtering (include/exclude)
- Sorting by title, date, and page count
- Responsive filter UI with collapsible panels

## API Integration
- Frontend components fetch data from the Express API
- API endpoints are mounted at `/api/...`
- Manuscript data retrieved from Google Cloud Storage
- API caches manuscript index for improved performance

## Data Flow
1. User navigates to a route
2. Component requests data from API endpoints
3. API retrieves and caches data from Google Cloud Storage
4. Component renders the data with appropriate UI
5. Search/filter operations use cached index for performance

## Styling Approach
- Component-specific styles using Svelte's scoped styling
- Responsive design for all screen sizes
- Mobile-optimized interfaces