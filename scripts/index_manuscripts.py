#!/usr/bin/env python3
"""
Lightweight Client-Side Manuscript Index Generator

Generates a compact search index JSON file with:
- Basic manuscript metadata
- Page counts
- PCA-based 3D coordinates for visualization
- Facet data for filtering
"""

import os
import json
import tempfile
import argparse
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional
import numpy as np
from dotenv import load_dotenv
from google.cloud import storage
from tqdm import tqdm
from sklearn.decomposition import PCA
from sklearn.feature_extraction.text import TfidfVectorizer
import pycountry  # For language code standardization

# Load environment variables from .env file
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# --------------------------------
# CONFIGURATION
# --------------------------------

# Google Cloud Storage bucket
GCS_BUCKET_NAME = os.environ.get('GCS_BUCKET_NAME')

# Cloud storage path for the index file
CLOUD_OUTPUT_PATH = 'catalogue/search-index.json'

# Local output path (optional)
LOCAL_OUTPUT_PATH = os.environ.get('INDEX_OUTPUT_PATH', './public/search-index.json')

# Save a local copy (set to 'true' in .env)
SAVE_LOCAL_COPY = os.environ.get('SAVE_LOCAL_COPY', 'false').lower() == 'true'

# --------------------------------
# SCRIPT KEYWORD EXTRACTION
# --------------------------------

def extract_script_keywords(description: str) -> List[str]:
    """
    Extract standardized script keywords from a script type description.
    
    Args:
        description: Script type description string
        
    Returns:
        List of standardized script keywords
    """
    if not description or not isinstance(description, str):
        return []
        
    keywords = set()
    description = description.lower()
    
    # Skip non-applicable descriptions
    if any(term in description for term in ["n/a", "not applicable"]):
        return ["not_applicable"]
    
    # Main script families
    script_families = {
        "gothic": ["gothic", "textura", "textualis", "rotunda"],
        "humanistic": ["humanist", "humanistic", "roman"],
        "carolingian": ["caroline", "carolingian"],
        "insular": ["insular", "anglo-saxon", "irish"],
        "cursive": ["cursive", "cursiva"],
        "secretary": ["secretary"],
        "bastarda": ["bastarda", "bâtarde", "batarde"],
        "hybrida": ["hybrida"],
        "italic": ["italic"],
        "beneventan": ["beneventan"],
        "mercantesca": ["mercantesca"],
        "anglicana": ["anglicana"]
    }
    
    # Script attributes
    attributes = {
        "textualis": ["textualis", "textura"],
        "quadrata": ["quadrata"],
        "rotunda": ["rotunda", "rounded"],
        "formata": ["formata"],
        "minuscule": ["minuscule"],
        "majuscule": ["majuscule"],
        "semi-cursive": ["semi-cursive"],
        "bookhand": ["bookhand", "book hand", "book-hand"],
        "semi-quadrata": ["semi-quadrata", "semiquadrata"],
        "protogothic": ["protogothic"],
        "uncial": ["uncial", "semiuncial"]
    }
    
    # First extract main family
    for family, terms in script_families.items():
        if any(term in description for term in terms):
            keywords.add(family)
    
    # Then extract attributes
    for attribute, terms in attributes.items():
        if any(term in description for term in terms):
            keywords.add(attribute)
    
    # If we couldn't extract any keywords, add "other" as a fallback
    if not keywords and description.strip():
        keywords.add("other")
    
    return list(keywords)

# --------------------------------
# MATERIAL KEYWORD EXTRACTION
# --------------------------------

def extract_material_keywords(description: str) -> List[str]:
    """
    Extract standardized material keywords from a textual description.
    
    Args:
        description: Material description string
        
    Returns:
        List of standardized material keywords
    """
    if not description or not isinstance(description, str):
        return []
        
    keywords = set()
    description = description.lower()
    
    # Primary materials
    if any(term in description for term in ["parchment", "vellum"]):
        keywords.add("parchment")  # Standardize vellum as parchment
    
    if "paper" in description:
        keywords.add("paper")
    
    # Binding materials
    leather_terms = ["leather", "calf", "morocco", "sheep", "pigskin", "goatskin"]
    if any(term in description for term in leather_terms):
        keywords.add("leather")
    
    if any(term in description for term in ["wood", "wooden", "boards"]):
        keywords.add("wooden")
    
    if "cloth" in description:
        keywords.add("cloth")
        
    # Decorative elements
    if any(term in description for term in ["gilt", "gold", "silver"]):
        keywords.add("metal_decoration")
    
    if any(term in description for term in ["paint", "gouache", "oil", "illuminat"]):
        keywords.add("painted")
    
    # Format
    if any(term in description for term in ["fragment", "leaf", "bifolium"]):
        keywords.add("fragment")
    
    # Other significant keywords
    special_features = {
        "tooled": "tooling",
        "clasp": "clasps",
        "binding": "binding",
        "modern": "modern",
        "contemporary": "contemporary",
        "mount": "mounted",
        "rebacked": "restored",
        "new": "restored",
        "stamped": "stamped"
    }
    
    for term, keyword in special_features.items():
        if term in description:
            keywords.add(keyword)
    
    return list(keywords)

# --------------------------------
# LANGUAGE STANDARDIZATION
# --------------------------------

def standardize_languages(languages: List[str]) -> List[str]:
    """
    Standardize language names to ISO 639-3 codes
    
    Args:
        languages: List of language names or codes
        
    Returns:
        List of standardized ISO 639-3 language codes
    """
    # Manual mapping for non-standard forms and special cases
    mapping = {
        "Middle English": "enm",
        "English, Middle (1100-1500)": "enm",
        "French, Middle (ca.1400-1600)": "frm",
        "Greek, Ancient (to 1453)": "grc",
        "Church Slavic": "chu",
        "Middle High German": "gmh",
        "German, Middle High (ca.1050-1500)": "gmh",
        "No linguistic content; Not applicable": "zxx",
        "none": "zxx",
    }
    
    standardized_langs = []
    
    for lang in languages:
        lang = str(lang).strip()
        
        # Check if we have a manual mapping
        if lang in mapping:
            code = mapping[lang]
            if code not in standardized_langs:
                standardized_langs.append(code)
            continue
            
        # Try to find in pycountry
        try:
            # Try direct lookup by name
            language = pycountry.languages.get(name=lang)
            if language and hasattr(language, 'alpha_3'):
                if language.alpha_3 not in standardized_langs:
                    standardized_langs.append(language.alpha_3)
                continue
                
            # Try lookup by alpha-2 if it looks like a code
            if len(lang) == 2:
                language = pycountry.languages.get(alpha_2=lang)
                if language and hasattr(language, 'alpha_3'):
                    if language.alpha_3 not in standardized_langs:
                        standardized_langs.append(language.alpha_3)
                    continue
                    
            # Try lookup by alpha-3 if it looks like a code
            if len(lang) == 3:
                language = pycountry.languages.get(alpha_3=lang)
                if language:
                    if lang not in standardized_langs:
                        standardized_langs.append(lang)
                    continue
        except Exception as e:
            logger.debug(f"Error looking up language '{lang}': {e}")
            
        # If all lookups fail, keep the original if not already added
        if lang not in standardized_langs:
            standardized_langs.append(lang)
    
    return standardized_langs

# Language metadata for client reference
LANGUAGE_METADATA = {
    # Classical languages
    "la": {"name": "Latin", "is_historical": True},
    "grc": {"name": "Ancient Greek", "is_historical": True, "parent": "el"},
    "chu": {"name": "Church Slavic", "is_historical": True},
    
    # Germanic languages
    "en": {"name": "English"},
    "enm": {"name": "Middle English", "is_historical": True, "parent": "en"},
    "ang": {"name": "Old English", "is_historical": True, "parent": "en"},
    "de": {"name": "German"},
    "gmh": {"name": "Middle High German", "is_historical": True, "parent": "de"},
    "goh": {"name": "Old High German", "is_historical": True, "parent": "de"},
    
    # Romance languages
    "fr": {"name": "French"},
    "frm": {"name": "Middle French", "is_historical": True, "parent": "fr"},
    "fro": {"name": "Old French", "is_historical": True, "parent": "fr"},
    "it": {"name": "Italian"},
    "es": {"name": "Spanish"},
    "pt": {"name": "Portuguese"},
    
    # Other languages
    "ar": {"name": "Arabic"},
    "el": {"name": "Greek"},
    "he": {"name": "Hebrew"},
    "zxx": {"name": "No linguistic content"},
}

# --------------------------------
# FACET EXTRACTION
# --------------------------------

def extract_facets(documents: List[Dict[str, Any]]) -> Dict[str, Dict[str, List[str]]]:
    """
    Extract facets from a set of documents
    
    Args:
        documents: List of manuscript documents
        
    Returns:
        Facet data mapping facet types to values and document IDs
    """
    facets = {
        'languages': {},
        'material_keywords': {},
        'script_keywords': {},
        'repository': {}
    }
    
    for doc in documents:
        try:
            doc_id = doc['id']
            
            # Languages facet (array) - with standardization
            languages = doc.get('languages', [])
            if languages:
                if not isinstance(languages, list):
                    languages = [str(languages)]
                
                # Standardize language codes
                standardized_langs = standardize_languages(languages)
                
                for lang in standardized_langs:
                    if lang not in facets['languages']:
                        facets['languages'][lang] = []
                    facets['languages'][lang].append(doc_id)
            
            # Material keywords facet
            material_keywords = doc.get('material_keywords', [])
            if isinstance(material_keywords, list):
                for keyword in material_keywords:
                    if keyword not in facets['material_keywords']:
                        facets['material_keywords'][keyword] = []
                    facets['material_keywords'][keyword].append(doc_id)
            
            # Script keywords facet
            script_keywords = doc.get('script_keywords', [])
            if isinstance(script_keywords, list):
                for keyword in script_keywords:
                    if keyword not in facets['script_keywords']:
                        facets['script_keywords'][keyword] = []
                    facets['script_keywords'][keyword].append(doc_id)
            
            # Repository facet
            repository = str(doc.get('repository', 'Unknown'))
            if repository not in facets['repository']:
                facets['repository'][repository] = []
            facets['repository'][repository].append(doc_id)
            
        except Exception as e:
            logger.warning(f"Error processing facets for document: {e}")
            continue
    
    return facets

# --------------------------------
# PCA COORDINATES GENERATION
# --------------------------------

def generate_pca_coordinates(documents: List[Dict[str, Any]]) -> Dict[str, Dict[str, float]]:
    """
    Generate 3D coordinates using PCA for manuscript similarity visualization.
    
    Args:
        documents: List of manuscript documents
        
    Returns:
        Dictionary mapping manuscript IDs to x, y, z coordinates
    """
    logger.info("Generating PCA coordinates for manuscript similarity...")
    
    # Extract text content for analysis
    corpus = []
    valid_indices = []
    
    for i, doc in enumerate(documents):
        # Combine relevant text fields
        text = " ".join(filter(None, [
            doc.get("title", ""),
            doc.get("contents_summary", ""),
            " ".join(str(theme) for theme in doc.get("themes", [])) if isinstance(doc.get("themes", []), list) else "",
            str(doc.get("historical_context", "")),
            str(doc.get("language", ""))
        ]))
        
        if text.strip():
            corpus.append(text)
            valid_indices.append(i)
    
    if len(corpus) < 3:
        logger.warning("Not enough documents with text for PCA. Using random coordinates.")
        result = {}
        for doc in documents:
            result[doc["id"]] = [
                np.random.uniform(-1, 1),
                np.random.uniform(-1, 1),
                np.random.uniform(-1, 1)
            ]
        return result
    
    try:
        # Create TF-IDF features
        vectorizer = TfidfVectorizer(max_features=1000, stop_words='english')
        features = vectorizer.fit_transform(corpus)
        
        # Apply PCA to reduce to 3 dimensions
        pca = PCA(n_components=min(3, len(corpus), features.shape[1]))
        coords_3d = pca.fit_transform(features.toarray())
        
        # Normalize coordinates to range [-1, 1]
        coords_min = coords_3d.min(axis=0)
        coords_max = coords_3d.max(axis=0)
        coords_range = coords_max - coords_min
        
        # Avoid division by zero if all coordinates in a dimension are the same
        for i in range(coords_range.shape[0]):
            if coords_range[i] == 0:
                coords_range[i] = 1.0
                
        normalized = 2 * (coords_3d - coords_min) / coords_range - 1
        
        # Add coordinates to documents
        result = {}
        for i, doc_idx in enumerate(valid_indices):
            doc_id = documents[doc_idx]["id"]
            result[doc_id] = [
                float(normalized[i, 0]),
                float(normalized[i, 1]) if normalized.shape[1] > 1 else 0.0,
                float(normalized[i, 2]) if normalized.shape[1] > 2 else 0.0
            ]
        
        # Add random coordinates for documents without text
        for doc in documents:
            if doc["id"] not in result:
                result[doc["id"]] = [
                    np.random.uniform(-1, 1),
                    np.random.uniform(-1, 1),
                    np.random.uniform(-1, 1)
                ]
        
        logger.info(f"Generated PCA coordinates for {len(result)} manuscripts")
        return result
        
    except Exception as e:
        logger.error(f"Error generating PCA coordinates: {e}")
        # Fallback to random coordinates
        result = {}
        for doc in documents:
            result[doc["id"]] = {
                "x": np.random.uniform(-1, 1),
                "y": np.random.uniform(-1, 1),
                "z": np.random.uniform(-1, 1)
            }
        return result

# --------------------------------
# PAGE COUNT FUNCTION
# --------------------------------

def get_page_count(bucket, manuscript_id: str) -> int:
    """
    Get the number of pages for a manuscript by counting page directories.
    
    Args:
        bucket: GCS bucket object
        manuscript_id: Manuscript ID
        
    Returns:
        Number of pages
    """
    page_prefix = f"catalogue/{manuscript_id}/pages/"
    
    # List all blobs with the pages prefix
    blobs = list(bucket.list_blobs(prefix=page_prefix))
    
    # Extract unique page directory names
    page_dirs = set()
    for blob in blobs:
        path_after_prefix = blob.name[len(page_prefix):]
        if '/' in path_after_prefix:
            page_dir = path_after_prefix.split('/')[0]
            if page_dir.isdigit():
                page_dirs.add(page_dir)
    
    return len(page_dirs)

# --------------------------------
# DOCUMENT PROCESSING
# --------------------------------

def process_manuscript_metadata(
    id: str, 
    metadata: Dict[str, Any],
    bucket
) -> Dict[str, Any]:
    """
    Process manuscript metadata for indexing
    
    Args:
        id: Manuscript ID
        metadata: Manuscript metadata
        bucket: GCS bucket object
        
    Returns:
        Processed document ready for indexing
    """
    
    # Helper functions to ensure correct types
    def ensure_list(value, default=None):
        if default is None:
            default = []
        if not value:
            return default
        return value if isinstance(value, list) else [str(value)]
    
    def ensure_str(value, default=''):
        if not value:
            return default
        return str(value)
    
    # Handle date range safely
    date_range = metadata.get('date_range')
    date_info = {}
    
    if date_range and isinstance(date_range, list) and len(date_range) > 0:
        try:
            start_year = int(date_range[0])
            end_year = int(date_range[1]) if len(date_range) > 1 else start_year
            
            # Add specific date information
            date_info = {
                "start_year": start_year,
                "end_year": end_year,
                "date_range_text": f"{start_year}-{end_year}"
            }
        except (IndexError, TypeError, ValueError):
            pass
    
    # Handle coordinates safely
    coordinates = {}
    if metadata.get('coordinates') and isinstance(metadata['coordinates'], list) and len(metadata['coordinates']) >= 2:
        try:
            lat = float(metadata['coordinates'][0])
            lon = float(metadata['coordinates'][1])
            
            # Add coordinates if they appear valid
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                coordinates = {
                    "latitude": lat,
                    "longitude": lon
                }
        except (IndexError, TypeError, ValueError):
            pass
    
    # Extract physical description safely
    phys_desc = metadata.get('physical_description', {})
    if not isinstance(phys_desc, dict):
        phys_desc = {}
    
    # Extract script type safely
    script_type = "unknown"
    if isinstance(phys_desc, dict):
        script_type = ensure_str(phys_desc.get("script_type"), "unknown")
    
    # Extract script keywords
    script_keywords = extract_script_keywords(script_type)
    
    # Extract decoration information safely
    illuminations_desc = ""
    artistic_style = ""
    decoration = phys_desc.get('decoration', {})
    if isinstance(decoration, dict):
        illuminations_desc = ensure_str(decoration.get('illuminations', ''))
        artistic_style = ensure_str(decoration.get('artistic_style', ''))
    
    # Get material type safely
    material_type = "unknown"
    if isinstance(phys_desc, dict):
        material_type = ensure_str(phys_desc.get("material"), "unknown")
    
    # Extract material keywords
    material_keywords = extract_material_keywords(material_type)
    
    # Also check for additional material info in binding and artwork
    if isinstance(phys_desc, dict):
        # Check binding description
        binding_desc = ensure_str(phys_desc.get("binding"), "")
        if binding_desc:
            material_keywords.extend(extract_material_keywords(binding_desc))
        
        # Check artwork description
        artwork_desc = ensure_str(phys_desc.get("artwork"), "")
        if artwork_desc:
            material_keywords.extend(extract_material_keywords(artwork_desc))
    
    # Remove duplicates while preserving order
    material_keywords = list(dict.fromkeys(material_keywords))
    
    # Get page count
    page_count = get_page_count(bucket, id)
    
    # Standardize languages
    raw_languages = ensure_list(metadata.get("languages"), ["Unknown"])
    standardized_languages = standardize_languages(raw_languages)
    
    # Create processed document with minimal fields for search results display
    processed_doc = {
        "id": id,
        "title": ensure_str(metadata.get("title"), "Untitled Manuscript"),
        "shelfmark": ensure_str(metadata.get("shelfmark"), ""),
        "repository": ensure_str(metadata.get("repository"), ""),
        "authors": ensure_list(metadata.get("authors"), ["Unknown"]),
        "origin_location": ensure_str(metadata.get("origin_location"), "Unknown"),
        "languages": standardized_languages,
        "material_keywords": material_keywords,  # Add extracted keywords
        "script_keywords": script_keywords,  # Add extracted script keywords
        "page_count": page_count,
        "brief": (
            f"{ensure_str(metadata.get('contents_summary'))}" 
            if metadata.get('contents_summary') 
            else "No description available"
        ),
        **date_info,  # Add date range information
        **coordinates  # Add coordinates if available
    }
    
    # For internal search use - not included in output document
    full_metadata = {
        **processed_doc,
        "alternative_titles": ensure_list(metadata.get("alternative_titles"), []),
        "provenance": ensure_str(metadata.get("provenance"), ""),
        "contents_summary": ensure_str(metadata.get("contents_summary"), ""),
        "historical_context": ensure_str(metadata.get("historical_context"), ""),
        "physical_description": phys_desc,
        "illuminations_description": illuminations_desc,
        "artistic_style": artistic_style,
        "scribes": ensure_list(metadata.get("scribes"), [])
    }
    
    return {
        "document": processed_doc,
        "fullMetadata": full_metadata,
    }

# --------------------------------
# INDEX BUILDING FUNCTION
# --------------------------------

def build_search_index(processed_documents: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Build the complete search index
    
    Args:
        processed_documents: List of processed manuscript data
        
    Returns:
        Complete search index structure
    """
    logger.info(f"Building search index for {len(processed_documents)} manuscripts...")
    
    # Extract document data for search results
    documents = [item["document"] for item in processed_documents]
    
    # Extract full metadata for PCA and facets
    full_metadata_items = [item["fullMetadata"] for item in processed_documents]
    
    # Generate PCA coordinates
    pca_coords = generate_pca_coordinates(full_metadata_items)
    
    # Add PCA coordinates to documents
    for doc in documents:
        doc_id = doc["id"]
        if doc_id in pca_coords:
            doc["pca_coords"] = pca_coords[doc_id]
    
    # Extract facets
    facets = extract_facets(full_metadata_items)
    logger.info("Extracted facets for filtering")
    
    # Construct the final index
    from datetime import datetime
    return {
        "metadata": {
            "version": 1,
            "manuscriptCount": len(documents),
            "generatedDate": datetime.now().isoformat(),
            "language_metadata": LANGUAGE_METADATA
        },
        "documents": documents,
        "facets": facets
    }

# --------------------------------
# GOOGLE CLOUD STORAGE FUNCTIONS
# --------------------------------

def get_metadata_files_from_gcs(bucket):
    """Get list of metadata files from Google Cloud Storage"""
    # Path to manuscripts in the bucket
    catalogue_path = 'catalogue/'
    
    # List all blobs with the catalogue prefix
    all_blobs = list(bucket.list_blobs(prefix=catalogue_path))
    
    # Extract unique manuscript IDs from paths
    manuscript_ids = set()
    for blob in all_blobs:
        parts = blob.name.split('/')
        if len(parts) > 2:  # catalogue/manuscript_id/...
            manuscript_ids.add(parts[1])
    
    logger.info(f"Found {len(manuscript_ids)} manuscript directories")
    
    # Look specifically for metadata files
    metadata_files = []
    for manuscript_id in manuscript_ids:
        metadata_path = f"{catalogue_path}{manuscript_id}/standard_metadata.json"
        
        # Check if this specific file exists
        metadata_blob = bucket.blob(metadata_path)
        if metadata_blob.exists():
            metadata_files.append({
                "name": metadata_path,
                "manuscriptId": manuscript_id
            })
        else:
            logger.warning(f"No standard_metadata.json found for {manuscript_id}, skipping this manuscript")
    
    logger.info(f"Found {len(metadata_files)} manuscripts with standard_metadata.json files")
    return metadata_files

def upload_search_index(bucket, search_index: Dict[str, Any]) -> Dict[str, Any]:
    """
    Upload search index to Google Cloud Storage
    
    Args:
        bucket: GCS bucket object
        search_index: The search index to upload
        
    Returns:
        Upload result info
    """
    logger.info(f"Uploading search index to gs://{GCS_BUCKET_NAME}/{CLOUD_OUTPUT_PATH}...")
    
    try:
        # Create blob and upload
        blob = bucket.blob(CLOUD_OUTPUT_PATH)
        
        # Convert to JSON and upload
        index_content = json.dumps(search_index)
        blob.upload_from_string(
            index_content,
            content_type='application/json',
            timeout=300  # 5 minute timeout for large files
        )
        
        # Set cache control
        blob.cache_control = 'public, max-age=3600'  # 1 hour cache
        blob.patch()
        
        logger.info(f"Successfully uploaded search index to gs://{GCS_BUCKET_NAME}/{CLOUD_OUTPUT_PATH}")
        
        # Get file size
        size_bytes = blob.size
        
        return {
            "success": True,
            "path": f"gs://{GCS_BUCKET_NAME}/{CLOUD_OUTPUT_PATH}",
            "size": size_bytes
        }
    except Exception as e:
        logger.error(f"Error uploading search index: {str(e)}")
        raise

# --------------------------------
# MAIN FUNCTION
# --------------------------------

def generate_search_index() -> Dict[str, Any]:
    """
    Main function to generate the search index
    
    Returns:
        Result information
    """
    logger.info("Starting client-side search index generation...")
    
    try:
        # Validate bucket name
        if not GCS_BUCKET_NAME:
            raise ValueError("GCS_BUCKET_NAME is not set. Please configure it in .env or environment variables.")
        
        # Initialize storage client
        storage_client = storage.Client()
        bucket = storage_client.bucket(GCS_BUCKET_NAME)
        
        # Check if bucket exists
        if not bucket.exists():
            raise ValueError(f"Bucket '{GCS_BUCKET_NAME}' does not exist")
        
        logger.info(f"Using GCS bucket: {GCS_BUCKET_NAME}")
        
        # Get metadata files from GCS
        metadata_files = get_metadata_files_from_gcs(bucket)
        
        # Process all manuscripts
        processed_documents = []
        error_count = 0
        
        # Use tqdm for progress bar
        for file_info in tqdm(metadata_files, desc="Processing manuscripts"):
            file_path = file_info["name"]
            manuscript_id = file_info["manuscriptId"]
            
            try:
                # Get blob object
                blob = bucket.blob(file_path)
                
                # Create temp file for downloading
                with tempfile.NamedTemporaryFile(suffix=".json") as temp_file:
                    # Download file
                    blob.download_to_filename(temp_file.name)
                    
                    # Read and parse metadata
                    with open(temp_file.name, 'r') as f:
                        manuscript_data = json.load(f)
                
                # Process metadata
                processed_doc = process_manuscript_metadata(
                    manuscript_id,
                    manuscript_data,
                    bucket
                )
                
                processed_documents.append(processed_doc)
            
            except Exception as e:
                logger.error(f"Error processing {file_path}: {str(e)}")
                error_count += 1
        
        # Build the search index
        search_index = build_search_index(processed_documents)
        
        # Upload to Google Cloud Storage
        upload_result = upload_search_index(bucket, search_index)
        
        # Optionally save locally
        local_file_size = 0
        if SAVE_LOCAL_COPY:
            # Ensure output directory exists
            os.makedirs(os.path.dirname(LOCAL_OUTPUT_PATH), exist_ok=True)
            
            # Write index to file
            with open(LOCAL_OUTPUT_PATH, 'w') as f:
                json.dump(search_index, f)
                
            local_file_size = os.path.getsize(LOCAL_OUTPUT_PATH)
            logger.info(f"Also saved index locally to {LOCAL_OUTPUT_PATH}")
        
        # Print size info
        cloud_size_mb = upload_result['size'] / (1024 * 1024)
        logger.info(f"""
Index generation complete:
- Documents indexed: {search_index['metadata']['manuscriptCount']}
- Facet types: {len(search_index['facets'])}
- Cloud storage path: gs://{GCS_BUCKET_NAME}/{CLOUD_OUTPUT_PATH}
- File size: {cloud_size_mb:.2f} MB
        """)
        
        return {
            "success": True,
            "documents": search_index['metadata']['manuscriptCount'],
            "cloudPath": f"gs://{GCS_BUCKET_NAME}/{CLOUD_OUTPUT_PATH}",
            "cloudFileSize": upload_result['size'],
            "localPath": LOCAL_OUTPUT_PATH if SAVE_LOCAL_COPY else None,
            "localFileSize": local_file_size
        }
    
    except Exception as e:
        logger.error(f"Index generation failed: {str(e)}")
        raise

# --------------------------------
# COMMAND LINE INTERFACE
# --------------------------------

def parse_args():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(
        description="Generate lightweight client-side search index for Ley-Star manuscripts"
    )
    parser.add_argument(
        "--save-local",
        action="store_true",
        help="Save a local copy of the index (default: False)"
    )
    parser.add_argument(
        "--output",
        type=str,
        help="Local output path for the index (default: ./public/search-index.json)"
    )
    
    return parser.parse_args()

# --------------------------------
# MAIN ENTRY POINT
# --------------------------------

if __name__ == "__main__":
    # Parse command line arguments
    args = parse_args()
    
    # Override environment variables with command line arguments
    if args.save_local:
        SAVE_LOCAL_COPY = True
    
    if args.output:
        LOCAL_OUTPUT_PATH = args.output
    
    # Run the index generator
    try:
        result = generate_search_index()
        logger.info(f"Index generation job completed successfully. Generated index with {result['documents']} manuscripts.")
        exit(0)
    except Exception as e:
        logger.error(f"Index generation job failed: {str(e)}")
        exit(1)