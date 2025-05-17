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
    # Manual mapping for non-standard forms, special cases, 
    # and direct 2-to-3 letter ISO code mappings
    mapping = {
        # Non-standard language names
        "Middle English": "enm",
        "English, Middle (1100-1500)": "enm",
        "French, Middle (ca.1400-1600)": "frm",
        "Greek, Ancient (to 1453)": "grc",
        "Church Slavic": "chu",
        "Middle High German": "gmh",
        "German, Middle High (ca.1050-1500)": "gmh",
        "No linguistic content; Not applicable": "zxx",
        "none": "zxx",
        
        # Common 2-letter to 3-letter ISO code mappings
        "en": "eng",
        "fr": "fra",  # Note: ISO 639-2/T uses "fra" not "fre"
        "de": "deu",  # Note: ISO 639-2/T uses "deu" not "ger"
        "it": "ita",
        "es": "spa",
        "la": "lat",  # Latin
        "el": "ell",  # Greek (modern)
        "ar": "ara",  # Arabic
        "he": "heb",  # Hebrew
        "ru": "rus",  # Russian
        "zh": "zho",  # Chinese
        "ja": "jpn",  # Japanese
        "pt": "por",  # Portuguese
        "nl": "nld",  # Dutch
        "sv": "swe",  # Swedish
        
        # Common variations
        "Latin": "lat",
        "Greek": "grc",  # Assume Ancient Greek unless clearly specified as modern
        "Greek, Modern": "ell",
        "French": "fra",
        "German": "deu",
        "English": "eng",
        "Italian": "ita",
        "Spanish": "spa",
        "Arabic": "ara",
        "Hebrew": "heb",
    }
    
    standardized_langs = []
    
    for lang in languages:
        if not lang:  # Skip empty values
            continue
            
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
                # First check our mapping for common codes
                if lang in mapping:
                    code = mapping[lang]
                    if code not in standardized_langs:
                        standardized_langs.append(code)
                    continue
                    
                # Try pycountry lookup
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
                
            # Try partial name matching for common languages
            lower_lang = lang.lower()
            for key, value in mapping.items():
                if key.lower() in lower_lang or lower_lang in key.lower():
                    if value not in standardized_langs:
                        standardized_langs.append(value)
                        break
            else:  # No match found in the for loop
                # If all lookups fail, keep the original if not already added
                if lang not in standardized_langs:
                    standardized_langs.append(lang)
                    
        except Exception as e:
            logger.debug(f"Error looking up language '{lang}': {e}")
            
            # If exception, keep the original if not already added
            if lang not in standardized_langs:
                standardized_langs.append(lang)
    
    return standardized_langs

# Language metadata for client reference
LANGUAGE_METADATA = {
    # Classical languages
    "lat": {"name": "Latin", "is_historical": True},
    "grc": {"name": "Ancient Greek", "is_historical": True, "parent": "ell"},
    "chu": {"name": "Church Slavic", "is_historical": True},
    
    # Germanic languages
    "eng": {"name": "English"},
    "enm": {"name": "Middle English", "is_historical": True, "parent": "eng"},
    "ang": {"name": "Old English", "is_historical": True, "parent": "eng"},
    "deu": {"name": "German"},
    "gmh": {"name": "Middle High German", "is_historical": True, "parent": "deu"},
    "goh": {"name": "Old High German", "is_historical": True, "parent": "deu"},
    
    # Romance languages
    "fra": {"name": "French"},
    "frm": {"name": "Middle French", "is_historical": True, "parent": "fra"},
    "fro": {"name": "Old French", "is_historical": True, "parent": "fra"},
    "ita": {"name": "Italian"},
    "spa": {"name": "Spanish"},
    "por": {"name": "Portuguese"},
    
    # Other languages
    "ara": {"name": "Arabic"},
    "ell": {"name": "Modern Greek"},
    "heb": {"name": "Hebrew"},
    "zxx": {"name": "No linguistic content"},
}

# --------------------------------
# TRANSCRIPTION STATUS FUNCTION
# --------------------------------

def get_transcription_status(bucket, manuscript_id: str, page_count: int) -> str:
    """
    Determines the transcription status of a manuscript based on the presence of
    raw_transcript.txt files for its pages.

    Args:
        bucket: GCS bucket object.
        manuscript_id: The ID of the manuscript.
        page_count: The total number of pages in the manuscript.

    Returns:
        A string indicating the transcription status:
        "Fully Transcribed", "Partially Transcribed", or "Not Transcribed".
    """
    if not isinstance(page_count, int) or page_count <= 0:
        logger.warning(f"Manuscript {manuscript_id} has invalid page_count: {page_count}. Defaulting to 'Not Transcribed'.")
        return "Not Transcribed"

    transcribed_page_count = 0
    for page_num in range(1, page_count + 1):
        page_num_padded = str(page_num).zfill(4)
        transcript_path = f"catalogue/{manuscript_id}/pages/{page_num_padded}/raw_transcript.txt"
        
        blob = bucket.blob(transcript_path)
        if blob.exists():
            transcribed_page_count += 1
    
    if transcribed_page_count == 0:
        return "Not Transcribed"
    elif transcribed_page_count == page_count:
        return "Fully Transcribed"
    else:
        return "Partially Transcribed"

# --------------------------------
# FACET EXTRACTION
# --------------------------------

def extract_facets(documents: List[Dict[str, Any]]) -> Dict[str, Dict[str, List[str]]]:
    """
    Extract facets from a set of documents
    
    Args:
        documents: List of manuscript documents (full metadata items)
        
    Returns:
        Facet data mapping facet types to values and document IDs
    """
    facets = {
        'languages': {},
        'material_keywords': {},
        'script_keywords': {},
        'repository': {},
        'transcription_status': {} # New facet
    }
    
    for doc in documents:
        try:
            doc_id = doc['id']
            
            # Languages facet
            languages = doc.get('languages', [])
            if languages:
                if not isinstance(languages, list):
                    languages = [str(languages)]
                standardized_langs = standardize_languages(languages)
                for lang in standardized_langs:
                    facets['languages'].setdefault(lang, []).append(doc_id)
            
            # Material keywords facet
            material_keywords = doc.get('material_keywords', [])
            if isinstance(material_keywords, list):
                for keyword in material_keywords:
                    facets['material_keywords'].setdefault(keyword, []).append(doc_id)
            
            # Script keywords facet
            script_keywords = doc.get('script_keywords', [])
            if isinstance(script_keywords, list):
                for keyword in script_keywords:
                    facets['script_keywords'].setdefault(keyword, []).append(doc_id)
            
            # Repository facet
            repository = str(doc.get('repository', 'Unknown'))
            facets['repository'].setdefault(repository, []).append(doc_id)

            # Transcription status facet
            transcription_status = doc.get('transcription_status', 'Not Transcribed') # Default if somehow missing
            facets['transcription_status'].setdefault(transcription_status, []).append(doc_id)
            
        except Exception as e:
            logger.warning(f"Error processing facets for document {doc.get('id', 'UNKNOWN')}: {e}")
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
            str(doc.get("language", "")) # Assuming 'language' might be a single string here, not the list
        ]))
        
        if text.strip():
            corpus.append(text)
            valid_indices.append(i)
    
    if len(corpus) < 3:
        logger.warning("Not enough documents with text for PCA. Using random coordinates.")
        result = {}
        for doc_idx in range(len(documents)): # Iterate over original documents list
            doc_id = documents[doc_idx]["id"]
            result[doc_id] = [
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
        pca_n_components = min(3, features.shape[0], features.shape[1])
        if pca_n_components == 0: # Handle edge case where no features are generated
             logger.warning("PCA n_components is 0. Using random coordinates.")
             result = {}
             for doc_idx in range(len(documents)):
                 doc_id = documents[doc_idx]["id"]
                 result[doc_id] = [
                    np.random.uniform(-1, 1),
                    np.random.uniform(-1, 1),
                    np.random.uniform(-1, 1)
                 ]
             return result

        pca = PCA(n_components=pca_n_components)
        coords_3d = pca.fit_transform(features.toarray())
        
        # Normalize coordinates to range [-1, 1]
        coords_min = coords_3d.min(axis=0)
        coords_max = coords_3d.max(axis=0)
        coords_range = coords_max - coords_min
        
        # Avoid division by zero if all coordinates in a dimension are the same
        for i in range(coords_range.shape[0]):
            if coords_range[i] == 0:
                coords_range[i] = 1.0
                
        normalized_coords = 2 * (coords_3d - coords_min) / coords_range - 1
        
        # Add coordinates to documents
        result = {}
        for i, doc_idx_in_corpus in enumerate(valid_indices):
            doc_id = documents[doc_idx_in_corpus]["id"]
            # Ensure we handle cases where PCA might return fewer than 3 components
            x_coord = float(normalized_coords[i, 0]) if normalized_coords.shape[1] > 0 else 0.0
            y_coord = float(normalized_coords[i, 1]) if normalized_coords.shape[1] > 1 else 0.0
            z_coord = float(normalized_coords[i, 2]) if normalized_coords.shape[1] > 2 else 0.0
            result[doc_id] = [x_coord, y_coord, z_coord]
        
        # Add random coordinates for documents that were not in the corpus (e.g., no text)
        all_doc_ids = {doc["id"] for doc in documents}
        corpus_doc_ids = {documents[idx]["id"] for idx in valid_indices}
        docs_without_text_ids = all_doc_ids - corpus_doc_ids

        for doc_id in docs_without_text_ids:
            result[doc_id] = [
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
        for doc_idx in range(len(documents)): # Iterate over original documents list
            doc_id = documents[doc_idx]["id"]
            result[doc_id] = {
                "x": np.random.uniform(-1, 1),
                "y": np.random.uniform(-1, 1),
                "z": np.random.uniform(-1, 1)
            }
        return result

# --------------------------------
# PAGE COUNT FUNCTION
# --------------------------------

def get_page_count(bucket, manuscript_id: str, metadata: Dict[str, Any]) -> int:
    """
    Get the number of pages for a manuscript.
    Prioritizes 'page_count' from metadata if available and valid.
    Otherwise, counts page directories in GCS.
    
    Args:
        bucket: GCS bucket object
        manuscript_id: Manuscript ID
        metadata: The standard_metadata.json content for the manuscript
        
    Returns:
        Number of pages
    """
    # Try to get page_count from metadata first
    if metadata and 'page_count' in metadata:
        try:
            page_count_meta = int(metadata['page_count'])
            if page_count_meta >= 0: # Allow 0 for manuscripts with no pages documented yet
                # logger.debug(f"Using page_count {page_count_meta} from metadata for {manuscript_id}")
                return page_count_meta
        except (ValueError, TypeError):
            logger.warning(f"Invalid page_count '{metadata['page_count']}' in metadata for {manuscript_id}. Falling back to GCS scan.")

    # Fallback: Count page directories in GCS
    logger.debug(f"Falling back to GCS scan for page_count for {manuscript_id}")
    page_prefix = f"catalogue/{manuscript_id}/pages/"
    
    # List all blobs with the pages prefix
    blobs = list(bucket.list_blobs(prefix=page_prefix, delimiter='/')) # Use delimiter to list "directories"
    
    # The "prefixes" returned by list_blobs with a delimiter are the subdirectories.
    # We need to filter these to ensure they are numeric page directories.
    page_dirs = set()
    # GCS returns subdirectories in blob.name if delimiter is used,
    # and they end with the delimiter.
    # Or, we can iterate all blobs and extract page numbers.
    
    all_page_blobs = list(bucket.list_blobs(prefix=page_prefix))
    for blob in all_page_blobs:
        path_after_prefix = blob.name[len(page_prefix):]
        if '/' in path_after_prefix:
            page_dir_candidate = path_after_prefix.split('/')[0]
            if page_dir_candidate.isdigit(): # Ensure it's a numeric page folder
                page_dirs.add(page_dir_candidate)
    
    actual_page_count = len(page_dirs)
    # logger.debug(f"Counted {actual_page_count} page directories in GCS for {manuscript_id}")
    return actual_page_count

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
        metadata: Manuscript metadata (from standard_metadata.json)
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
            end_year = int(date_range[1]) if len(date_range) > 1 and date_range[1] is not None else start_year
            
            date_info = {
                "start_year": start_year,
                "end_year": end_year,
                "date_range_text": f"{start_year}" if start_year == end_year else f"{start_year}-{end_year}"
            }
        except (IndexError, TypeError, ValueError) as e:
            logger.warning(f"Error processing date_range for {id}: {date_range}, Error: {e}")
            pass # Keep date_info empty
    
    # Handle coordinates safely
    coordinates_data = {} # Renamed to avoid conflict with imported coordinates module if any
    raw_coords = metadata.get('coordinates')
    if raw_coords and isinstance(raw_coords, list) and len(raw_coords) >= 2:
        try:
            lat = float(raw_coords[0])
            lon = float(raw_coords[1])
            
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                coordinates_data = {
                    "latitude": lat,
                    "longitude": lon
                }
        except (IndexError, TypeError, ValueError) as e:
            logger.warning(f"Error processing coordinates for {id}: {raw_coords}, Error: {e}")
            pass
    
    # Extract physical description safely
    phys_desc = metadata.get('physical_description', {})
    if not isinstance(phys_desc, dict):
        phys_desc = {}
    
    # Extract script type safely
    script_type = ensure_str(phys_desc.get("script_type"), "unknown")
    script_keywords = extract_script_keywords(script_type)
    
    # Extract decoration information safely
    illuminations_desc = ""
    artistic_style = ""
    decoration = phys_desc.get('decoration', {})
    if isinstance(decoration, dict):
        illuminations_desc = ensure_str(decoration.get('illuminations', ''))
        artistic_style = ensure_str(decoration.get('artistic_style', ''))
    
    # Get material type safely
    material_type = ensure_str(phys_desc.get("material"), "unknown")
    material_keywords = extract_material_keywords(material_type)
    
    binding_desc = ensure_str(phys_desc.get("binding"), "")
    if binding_desc:
        material_keywords.extend(extract_material_keywords(binding_desc))
    
    artwork_desc = ensure_str(phys_desc.get("artwork"), "") # Assuming 'artwork' might exist
    if artwork_desc:
        material_keywords.extend(extract_material_keywords(artwork_desc))
    
    material_keywords = list(dict.fromkeys(material_keywords)) # Remove duplicates
    
    # Get page count (prioritizing metadata, then GCS scan)
    page_count = get_page_count(bucket, id, metadata)
    
    # Get transcription status
    transcription_status = get_transcription_status(bucket, id, page_count)
    
    # Standardize languages
    raw_languages = ensure_list(metadata.get("languages"), ["Unknown"])
    standardized_languages = standardize_languages(raw_languages)
    
    processed_doc = {
        "id": id,
        "title": ensure_str(metadata.get("title"), "Untitled Manuscript"),
        "shelfmark": ensure_str(metadata.get("shelfmark"), ""),
        "repository": ensure_str(metadata.get("repository"), ""),
        "authors": ensure_list(metadata.get("authors"), ["Unknown"]),
        "origin_location": ensure_str(metadata.get("origin_location"), "Unknown"),
        "languages": standardized_languages,
        "material_keywords": material_keywords,
        "script_keywords": script_keywords,
        "page_count": page_count,
        "transcription_status": transcription_status, # Added field
        "brief": (
            ensure_str(metadata.get('contents_summary')) 
            if metadata.get('contents_summary') 
            else "No description available"
        ),
        **date_info,
        **coordinates_data # Use the renamed variable
    }
    
    # For internal search use - not included in output document, but used for facets/PCA
    full_metadata = {
        **processed_doc, # Start with all fields from processed_doc
        "alternative_titles": ensure_list(metadata.get("alternative_titles"), []),
        "provenance": ensure_str(metadata.get("provenance"), ""), # Ensure provenance is string for TF-IDF
        "contents_summary": ensure_str(metadata.get("contents_summary"), ""), # Already in brief, but good for PCA
        "historical_context": ensure_str(metadata.get("historical_context"), ""),
        "physical_description": phys_desc, # Keep as dict for potential future use
        "themes": ensure_list(metadata.get("themes"), []), # For PCA
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

def build_search_index(processed_data_items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Build the complete search index.
    
    Args:
        processed_data_items: List of dictionaries, each containing 'document' and 'fullMetadata'.
        
    Returns:
        Complete search index structure.
    """
    logger.info(f"Building search index for {len(processed_data_items)} manuscripts...")
    
    # Extract document data for search results (the slimmed-down version)
    documents_for_output = [item["document"] for item in processed_data_items]
    
    # Extract full metadata for PCA and facets (this contains all fields, including transcription_status)
    full_metadata_for_processing = [item["fullMetadata"] for item in processed_data_items]
    
    # Generate PCA coordinates using full metadata
    pca_coords = generate_pca_coordinates(full_metadata_for_processing)
    
    # Add PCA coordinates to the output documents
    for doc_out in documents_for_output:
        doc_id = doc_out["id"]
        if doc_id in pca_coords:
            doc_out["pca_coords"] = pca_coords[doc_id]
    
    # Extract facets using full metadata
    facets = extract_facets(full_metadata_for_processing)
    logger.info(f"Extracted facets for filtering: {list(facets.keys())}")
    
    from datetime import datetime
    return {
        "metadata": {
            "version": 1.1, # Incremented version for new status field
            "manuscriptCount": len(documents_for_output),
            "generatedDate": datetime.now().isoformat(),
            "language_metadata": LANGUAGE_METADATA
        },
        "documents": documents_for_output,
        "facets": facets
    }

# --------------------------------
# INDEX LOADING AND CHECKING FUNCTIONS
# --------------------------------

def load_existing_index(bucket) -> Dict[str, Any]:
    """
    Load the existing search index from Google Cloud Storage
    
    Args:
        bucket: GCS bucket object
        
    Returns:
        The existing search index or None if it doesn't exist
    """
    logger.info(f"Checking for existing index at: gs://{GCS_BUCKET_NAME}/{CLOUD_OUTPUT_PATH}")
    
    try:
        blob = bucket.blob(CLOUD_OUTPUT_PATH)
        if not blob.exists():
            logger.info("No existing index found")
            return None
        
        with tempfile.NamedTemporaryFile(suffix=".json", mode="r", delete=False) as temp_file:
            temp_file_path = temp_file.name # Store path for reading after download
        
        blob.download_to_filename(temp_file_path)
            
        with open(temp_file_path, 'r', encoding='utf-8') as f:
            index_data = json.load(f)
        
        os.unlink(temp_file_path) # Clean up temp file
                
        if not isinstance(index_data, dict) or 'documents' not in index_data:
            logger.warning("Existing index has invalid structure")
            return None
                
        manuscript_count = len(index_data.get('documents', []))
        logger.info(f"Loaded existing index with {manuscript_count} manuscripts. Version: {index_data.get('metadata', {}).get('version', 'N/A')}")
            
        return index_data
                
    except Exception as e:
        logger.warning(f"Error loading existing index: {str(e)}")
        return None

def get_indexed_manuscript_ids(index_data: Dict[str, Any]) -> set:
    """
    Extract the set of manuscript IDs that are already indexed
    
    Args:
        index_data: The existing search index
        
    Returns:
        Set of manuscript IDs
    """
    if not index_data or 'documents' not in index_data:
        return set()
        
    return {doc.get('id') for doc in index_data['documents'] if doc.get('id')}

# --------------------------------
# GOOGLE CLOUD STORAGE FUNCTIONS
# --------------------------------

def get_metadata_files_from_gcs(bucket):
    """Get list of metadata files from Google Cloud Storage"""
    catalogue_path = 'catalogue/'
    all_blobs = list(bucket.list_blobs(prefix=catalogue_path))
    
    manuscript_ids = set()
    for blob in all_blobs:
        parts = blob.name.split('/')
        if len(parts) > 2 and parts[0] == 'catalogue' and parts[1]: 
            manuscript_ids.add(parts[1])
    
    logger.info(f"Found {len(manuscript_ids)} potential manuscript directories")
    
    metadata_files = []
    for manuscript_id in tqdm(list(manuscript_ids), desc="Checking metadata files"):
        metadata_path = f"{catalogue_path}{manuscript_id}/standard_metadata.json"
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
        blob = bucket.blob(CLOUD_OUTPUT_PATH)
        index_content = json.dumps(search_index, indent=2) # Add indent for readability if downloaded
        blob.upload_from_string(
            index_content,
            content_type='application/json',
            timeout=300
        )
        
        blob.cache_control = 'public, max-age=3600'
        blob.patch()
        
        logger.info(f"Successfully uploaded search index to gs://{GCS_BUCKET_NAME}/{CLOUD_OUTPUT_PATH}")
        
        size_bytes = len(index_content.encode('utf-8')) # More accurate size after dump
        
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

def generate_search_index(args) -> Dict[str, Any]:
    logger.info("Starting client-side search index generation...")
    
    if not GCS_BUCKET_NAME:
        raise ValueError("GCS_BUCKET_NAME is not set.")
    
    storage_client = storage.Client()
    bucket = storage_client.bucket(GCS_BUCKET_NAME)
    if not bucket.exists():
        raise ValueError(f"Bucket '{GCS_BUCKET_NAME}' does not exist")
    
    logger.info(f"Using GCS bucket: {GCS_BUCKET_NAME}")
    
    force_reindex = args.force
    
    existing_index = None
    processed_documents_from_existing = [] # Store 'fullMetadata' items from existing index

    if not force_reindex:
        existing_index = load_existing_index(bucket)
        if existing_index:
            logger.info(f"Existing index loaded. {len(existing_index.get('documents', []))} documents.")
            # Reconstruct fullMetadata items from the existing documents for merging
            for doc_data in existing_index.get('documents', []):
                # Assume the document in the index IS the fullMetadata for simplicity in merging.
                # If it's not, this part would need adjustment or we only add new ones.
                processed_documents_from_existing.append({"document": doc_data, "fullMetadata": doc_data})
        else:
            logger.info("No valid existing index found or error loading it.")
    
    indexed_manuscript_ids = get_indexed_manuscript_ids(existing_index) if existing_index else set()

    all_metadata_files_info = get_metadata_files_from_gcs(bucket)
    
    files_to_process_info = []
    if force_reindex:
        files_to_process_info = all_metadata_files_info
        logger.info(f"Forcing reindex of all {len(files_to_process_info)} manuscripts.")
        processed_documents_from_existing = [] # Discard existing if forcing reindex
    else:
        new_or_updated_files_count = 0
        for file_info in all_metadata_files_info:
            if file_info["manuscriptId"] not in indexed_manuscript_ids:
                files_to_process_info.append(file_info)
                new_or_updated_files_count +=1
        logger.info(f"Found {new_or_updated_files_count} new or updated manuscripts to process.")
        if not files_to_process_info and existing_index:
             logger.info("No new manuscripts to index. Using existing index.")
             # No need to re-upload if no changes
             return {
                "success": True,
                "documents": len(existing_index.get('documents', [])),
                "cloudPath": f"gs://{GCS_BUCKET_NAME}/{CLOUD_OUTPUT_PATH}",
                "cloudFileSize": bucket.blob(CLOUD_OUTPUT_PATH).size if bucket.blob(CLOUD_OUTPUT_PATH).exists() else 0,
                "localPath": None,
                "localFileSize": 0,
                "message": "No new manuscripts found, existing index is current."
            }

    newly_processed_documents_data = [] # Store as {"document": ..., "fullMetadata": ...}
    error_count = 0
    
    for file_info in tqdm(files_to_process_info, desc="Processing manuscript metadata"):
        file_path = file_info["name"]
        manuscript_id = file_info["manuscriptId"]
        
        try:
            blob = bucket.blob(file_path)
            with tempfile.NamedTemporaryFile(suffix=".json", mode="r", delete=False) as temp_file:
                temp_file_path = temp_file.name
            
            blob.download_to_filename(temp_file_path)
            
            with open(temp_file_path, 'r', encoding='utf-8') as f:
                manuscript_data = json.load(f)
            os.unlink(temp_file_path)
            
            processed_data_item = process_manuscript_metadata(manuscript_id, manuscript_data, bucket)
            newly_processed_documents_data.append(processed_data_item)
        
        except Exception as e:
            logger.error(f"Error processing {file_path}: {str(e)}", exc_info=True)
            error_count += 1

    # Combine existing (if not force_reindex) and newly processed documents
    # We need to ensure no duplicates if a manuscript was reprocessed.
    # `processed_documents_from_existing` contains fullMetadata dicts.
    # `newly_processed_documents_data` contains `{"document":slim, "fullMetadata":full}` dicts.
    
    final_processed_items_map = {} # Use a map to handle updates/overwrites
    
    # Add existing items first
    for item_data in processed_documents_from_existing:
        # item_data["fullMetadata"] is used for consistency
        final_processed_items_map[item_data["fullMetadata"]["id"]] = item_data
        
    # Add/overwrite with newly processed items
    for item_data in newly_processed_documents_data:
        final_processed_items_map[item_data["fullMetadata"]["id"]] = item_data
        
    final_processed_list = list(final_processed_items_map.values())

    if not final_processed_list and not existing_index: # No data at all
        logger.warning("No manuscripts processed and no existing index. Index will be empty.")

    search_index = build_search_index(final_processed_list)
    
    upload_result = upload_search_index(bucket, search_index)
    
    local_file_size = 0
    local_output_actual_path = None
    if SAVE_LOCAL_COPY or args.save_local:
        local_output_actual_path = args.output or LOCAL_OUTPUT_PATH
        os.makedirs(os.path.dirname(local_output_actual_path), exist_ok=True)
        with open(local_output_actual_path, 'w', encoding='utf-8') as f:
            json.dump(search_index, f, indent=2)
        local_file_size = os.path.getsize(local_output_actual_path)
        logger.info(f"Also saved index locally to {local_output_actual_path}")
    
    cloud_size_mb = upload_result['size'] / (1024 * 1024)
    num_indexed_docs = search_index['metadata']['manuscriptCount']
    
    action_msg = "regenerated" if force_reindex else "updated" if (existing_index or newly_processed_documents_data) else "generated"
    logger.info(f"""
Index {action_msg} successfully:
- Documents in index: {num_indexed_docs} (Errors processing: {error_count})
- Facet types: {len(search_index['facets'])}
- Cloud storage path: gs://{GCS_BUCKET_NAME}/{CLOUD_OUTPUT_PATH}
- File size: {cloud_size_mb:.2f} MB
    """)
    
    return {
        "success": True,
        "documents": num_indexed_docs,
        "cloudPath": f"gs://{GCS_BUCKET_NAME}/{CLOUD_OUTPUT_PATH}",
        "cloudFileSize": upload_result['size'],
        "localPath": local_output_actual_path,
        "localFileSize": local_file_size
    }

# --------------------------------
# COMMAND LINE INTERFACE
# --------------------------------

def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate lightweight client-side search index for Ley-Star manuscripts"
    )
    parser.add_argument(
        "--save-local",
        action="store_true",
        help="Save a local copy of the index (default: False, controlled by SAVE_LOCAL_COPY env var)"
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None, # Default will be handled by LOCAL_OUTPUT_PATH env var
        help=f"Local output path for the index (default: {LOCAL_OUTPUT_PATH} or from INDEX_OUTPUT_PATH env var)"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force regeneration of the entire index (default: False, only add new/updated manuscripts)"
    )
    
    return parser.parse_args()

# --------------------------------
# MAIN ENTRY POINT
# --------------------------------

if __name__ == "__main__":
    args = parse_args()
    
    # Override SAVE_LOCAL_COPY if --save-local is explicitly used
    if args.save_local:
        SAVE_LOCAL_COPY = True
    
    # Set LOCAL_OUTPUT_PATH if --output is provided, otherwise it uses env var or default
    if args.output:
        LOCAL_OUTPUT_PATH = args.output
    
    if args.force:
        logger.info("Running in FORCE mode - will regenerate entire index")
    else:
        logger.info("Running in INCREMENTAL UPDATE mode - will process new/changed manuscripts and merge with existing.")
    
    try:
        result = generate_search_index(args)
        logger.info(f"Index generation job completed. Status: {'Success' if result['success'] else 'Failed'}. Indexed {result['documents']} manuscripts.")
        exit(0)
    except ValueError as ve: # Catch specific configuration errors
        logger.error(f"Configuration error: {str(ve)}")
        exit(1)
    except Exception as e:
        logger.error(f"Index generation job failed with an unhandled exception: {str(e)}", exc_info=True)
        exit(1)