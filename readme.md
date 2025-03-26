# Ley-Star Manuscript Viewer

A web application for viewing, searching, and exploring historical manuscripts stored in Google Cloud Storage with basic search capabilities.

## Project Overview

Ley-Star is a platform that provides access to digitized manuscripts with rich metadata. The application consists of:

- **Backend API**: Node.js Express server accessing manuscript data from Google Cloud Storage
- **Frontend**: Svelte-based SPA for browsing and viewing manuscripts
- **Search**: Lightweight metadata search using indexing
- **Indexer**: Scripts for processing manuscript metadata and creating search indices

## Directory Structure

```
ley-star.deploy/
├── Dockerfile                    # Container definition for deployment
├── cloudbuild.yaml               # Google Cloud Build configuration
├── design.md                     # Design documentation
├── package.json                  # Project dependencies
├── readme.md                     # This file
├── scripts/
│   ├── convert_svelte_files.py   # Utility script for Svelte components
│   ├── image-processor.ts        # Image processing utilities
│   ├── index_manuscripts.js      # Manuscript indexing script for simple search
│   └── upload-manuscript.ts      # Script for uploading new manuscripts
├── server.js                     # Main Express server entry point
├── src/
│   ├── api/                      # Backend API code
│   │   └── index.js              # API routes and handlers
│   └── frontend/                 # Svelte frontend application
│       ├── src/
│       │   ├── App.svelte        # Main application component
│       │   ├── lib/
│       │   │   ├── components/   # Reusable UI components
│       │   │   │   ├── Banner.svelte
│       │   │   │   ├── Footer.svelte
│       │   │   │   ├── ManuscriptInfoViewer.svelte
│       │   │   │   ├── PageNavigator.svelte
│       │   │   │   ├── PageViewer.svelte
│       │   │   │   └── SplashBox.svelte
│       │   │   └── stores.js     # Svelte stores for state management
│       │   ├── routes/           # Application routes
│       │   │   ├── +layout.svelte
│       │   │   ├── +page.svelte
│       │   │   ├── Home.svelte
│       │   │   └── manuscripts/  # Manuscript-related routes
│       │   │       ├── +page.svelte
│       │   │       └── [id]/     # Dynamic routes by manuscript ID
│       │   │           └── +page.svelte
│       │   └── main.js           # Frontend entry point
│       ├── svelte.config.js      # Svelte configuration
│       └── vite.config.js        # Vite bundler configuration
└── static/                       # Static assets
    ├── background.png
    ├── favicon.png
    └── icon.png
```

## Core Features

- Browse available manuscripts
- View detailed manuscript information and metadata
- Navigate manuscript pages with high-quality images
- Search manuscripts by content, metadata, and historical context
- View transcriptions aligned with manuscript images

## API Endpoints

The following endpoints are available:

- `GET /health` - Health check endpoint
- `GET /api/manuscripts` - List all available manuscripts
- `POST /search` - Search the index
- `GET /search/index` - Retrieve the index
- `GET /api/manuscripts/:id` - Get metadata for a specific manuscript
- `GET /api/manuscripts/:id/pages` - List all pages for a manuscript
- `GET /api/manuscripts/:id/pages/:pageId` - Get available files for a specific page
- `GET /api/manuscripts/:id/pages/:pageId/image` - Get web.webp image for a page
- `GET /api/manuscripts/:id/pages/:pageId/thumbnail` - Get thumbnail.webp image for a page
- `GET /api/manuscripts/:id/pages/:pageId/segmentation` - Get segmentation.json for a page
- `GET /api/manuscripts/:id/pages/:pageId/transcript` - Get transcript.json for a page

## Expected Data Structure

The API expects the following data structure in your Google Cloud Storage bucket:

```
bucket-root/
  catalogue/
    manuscript_id/
      standard_metadata.json
      pages/
        XXXX/ (page folder, numeric with padding)
          full.webp
          web.webp
          thumbnail.webp
          segmentation.json
          transcript.json
```

## Development Setup

### Prerequisites

- Node.js v18 or later
- Google Cloud Storage bucket with manuscript data

### Environment Variables

Create a `.env` file with the following variables:

```
# Google Cloud
GCS_BUCKET_NAME=your-manuscripts-bucket
GOOGLE_APPLICATION_CREDENTIALS=path/to/credentials.json
GOOGLE_CLOUD_PROJECT=your-project-id

```

### Installation

```bash
# Install dependencies
npm install

# Install frontend dependencies
cd src/frontend && npm install
```

### Running the Application

```bash
# Development mode with API and frontend
npm run dev:all

# API only
npm run dev:api

# Frontend only
npm run dev:frontend

# Production build
npm run build
npm start
```

### Indexing Manuscripts

To index manuscripts:

```bash
node scripts/index_manuscripts.js
```

## Deployment

### Manual Deployment to Cloud Run

1. Build the Docker image:
```
docker build -t gcr.io/[YOUR_PROJECT_ID]/leystar-api .
```

2. Push the image to Google Container Registry:
```
docker push gcr.io/[YOUR_PROJECT_ID]/leystar-api
```

3. Deploy to Cloud Run:
```
gcloud run deploy leystar-api \
  --image gcr.io/[YOUR_PROJECT_ID]/leystar-api \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GCS_BUCKET_NAME=[YOUR_BUCKET_NAME]
```

### Automated Deployment with Cloud Build

1. Connect your repository to Cloud Build
2. Create a trigger that uses the provided `cloudbuild.yaml` file
3. Set the required substitution variables:
   - `_GCS_BUCKET_NAME`: Your Google Cloud Storage bucket name

### Custom Domain Setup (ley-star.com)

1. Verify domain ownership in Google Cloud Console
2. Map the domain to your Cloud Run service:
```
gcloud beta run domain-mappings create \
  --service leystar-api \
  --domain ley-star.com \
  --region us-central1
```

3. Add the provided DNS records to your domain registrar
4. Wait for DNS propagation and SSL certificate provisioning

### Service Account Permissions

The Cloud Run service needs the following IAM permissions:
- `roles/storage.objectViewer` on your Google Cloud Storage bucket

## License

UNLICENSED - Private project, all rights reserved.