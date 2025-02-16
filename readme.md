# Leystar 

## Deployment

This repository contains deployment configurations for the Leystar manuscript project.

## Structure

- `frontend/` - Deployment configurations for the Svelte frontend
- `backend/` - Deployment configurations for the Cloud Run backend (coming soon)

## Frontend Deployment

The frontend is deployed to Google Cloud Run at ley-star.com

### Setup

1. Install the Google Cloud SDK
2. Authenticate and set your project:
   ```bash
   gcloud auth login
   gcloud config set project [YOUR_PROJECT_ID]
   ```
3. Enable required services:
   ```bash
   gcloud services enable cloudbuild.googleapis.com
   gcloud services enable run.googleapis.com
   ```

### Manual Deployment

To deploy the frontend manually:

1. Clone the frontend repository into the frontend directory:
   ```bash
   git clone https://github.com/oliverwstein/ley-star frontend/src
   ```
2. Run the build:
   ```bash
   gcloud builds submit frontend --config=frontend/cloudbuild.yaml
   ```

### Automatic Deployment

The GitHub Actions workflow will automatically deploy when:
- Changes are pushed to the frontend repository's main branch
- Changes are made to the frontend deployment configuration in this repository

## Domain Configuration

The domain ley-star.com is configured through Google Cloud Run's domain mapping:

```bash
gcloud beta run domain-mappings create \
  --service leystar-frontend \
  --domain ley-star.com \
  --region us-central1
```