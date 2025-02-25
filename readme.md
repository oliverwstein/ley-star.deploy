# Leystar API

A Cloud Run service that provides an API for serving manuscript data from Google Cloud Storage.

## API Endpoints

The following endpoints are available:

- `GET /health` - Health check endpoint
- `GET /api/manuscripts` - List all available manuscripts
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

## Local Development

1. Clone this repository
2. Install dependencies with `npm install`
3. Create a `.env` file based on `.env.example`
4. Run the development server with `npm run dev`

## Deployment to Cloud Run

### Manual Deployment

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

## Custom Domain Setup (ley-star.com)

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

## Service Account Permissions

The Cloud Run service needs the following IAM permissions:
- `roles/storage.objectViewer` on your Google Cloud Storage bucket