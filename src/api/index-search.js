// JavaScript version of index-search.ts

/**
* Lightweight Client-Side Manuscript Search Module
 * 
 * This module provides a self-contained, lightweight search implementation for 
 * manuscript data that can run entirely in the browser or on a Node.js server.
 * 
 * ## Search Index Structure
 * 
 * The search index is a JSON object containing:
 * 
 * 1. `metadata` - Information about the index itself
 * 2. `documents` - Array of manuscript entries with searchable properties
 * 3. `facets` - Pre-computed facets for efficient filtering by category
 * 
 * ## Search Logic
 * 
 * The search logic is based on a filtering approach rather than a traditional ranked search:
 * 
 * 1. Each search operation (text, facet, date) produces a Set of matching manuscript IDs
 * 2. Multiple operations can be combined using boolean logic (AND, OR, NOT)
 * 3. Results include all manuscripts that match the combined criteria
 * 
 * This filter-based approach is ideal for:
 * - Faceted navigation of manuscripts
 * - Combining multiple search criteria
 * - Providing dynamic counts of available facets after filtering
 * 
 * The module supports:
 * - Text search with multiple matching strategies (exact, contains, startsWith, fuzzy)
 * - Faceted search with different combination types (any, all, none)
 * - Date range filtering (before, after, between)
 * - Boolean combinations (AND, OR, NOT)
 * 
 * The lightweight fuzzy search implementation handles common typos and
 * prefix matching without requiring external libraries.
 */

/**
 * Text search implementation
 */
class TextSearch {
  constructor(options) {
    this.options = options;
  }
  
  execute(index) {
    const results = new Set();
    const { fields, query, matchType = 'contains' } = this.options;
    
    // Normalize the query for case-insensitive search
    const normalizedQuery = query.toLowerCase();
    
    index.documents.forEach(doc => {
      // Check if any specified field matches the query
      const matches = fields.some(field => {
        const value = doc[field];
        
        // Handle different field types
        if (typeof value === 'string') {
          return this.matchString(value, normalizedQuery, matchType);
        } else if (Array.isArray(value)) {
          return value.some(item => 
            typeof item === 'string' && this.matchString(item, normalizedQuery, matchType)
          );
        }
        return false;
      });
      
      if (matches) {
        results.add(doc.id);
      }
    });
    
    return results;
  }
  
  matchString(value, query, matchType) {
    const normalizedValue = value.toLowerCase();
    
    switch (matchType) {
      case 'exact':
        return normalizedValue === query;
      case 'contains':
        return normalizedValue.includes(query);
      case 'startsWith':
        return normalizedValue.startsWith(query);
      case 'fuzzy':
        // Simple fuzzy matching
        return this.fuzzyMatch(normalizedValue, query);
      default:
        return normalizedValue.includes(query);
    }
  }
  
  fuzzyMatch(text, query) {
    // Direct match check (fast path)
    if (text.includes(query)) return true;
    
    // Too short to be meaningful for fuzzy matching
    if (query.length <= 2) return text.includes(query);
    
    // Split into words and check each one
    const words = text.toLowerCase().split(/\s+/);
    const queryLower = query.toLowerCase();
    
    for (const word of words) {
      // Direct word match
      if (word === queryLower) return true;
      
      // Word is long enough for fuzzy matching
      if (word.length >= 4 && queryLower.length >= 3) {
        // Character deletion check (handle simple typos)
        // For example, "manuscrpt" would match "manuscript"
        for (let i = 0; i < word.length; i++) {
          const candidate = word.substring(0, i) + word.substring(i + 1);
          if (candidate === queryLower) return true;
        }
        
        // First N characters match (useful for stemming/prefixes)
        // For example, "manuscri" would match "manuscript"
        const prefixLength = Math.min(queryLower.length, word.length) - 1;
        if (prefixLength >= 3 && word.substring(0, prefixLength) === queryLower.substring(0, prefixLength)) {
          return true;
        }
      }
    }
    
    return false;
  }
}

/**
 * Facet search implementation
 */
class FacetSearch {
  constructor(options) {
    this.options = options;
  }
  
  execute(index) {
    const { facetType, values, matchType = 'any' } = this.options;
    const results = new Set();
    const facets = index.facets[facetType];
    
    if (!facets) {
      return results; // Empty set if facet type doesn't exist
    }
    
    switch (matchType) {
      case 'any': {
        // Match if document has any of the specified values
        values.forEach(value => {
          const docIds = facets[value];
          if (docIds) {
            docIds.forEach(id => results.add(id));
          }
        });
        break;
      }
      case 'all': {
        // Match if document has all of the specified values
        if (values.length === 0) return results;
        
        const potentialMatches = new Map();
        
        values.forEach(value => {
          const docIds = facets[value];
          if (docIds) {
            docIds.forEach(id => {
              potentialMatches.set(id, (potentialMatches.get(id) || 0) + 1);
            });
          }
        });
        
        // Only include documents that matched all values
        potentialMatches.forEach((count, id) => {
          if (count === values.length) {
            results.add(id);
          }
        });
        break;
      }
      case 'none': {
        // Match if document has none of the specified values
        // Start with all document IDs
        index.documents.forEach(doc => {
          results.add(doc.id);
        });
        
        // Remove documents with any matching facet
        values.forEach(value => {
          const docIds = facets[value];
          if (docIds) {
            docIds.forEach(id => {
              results.delete(id);
            });
          }
        });
        break;
      }
    }
    
    return results;
  }
}

/**
 * Date range search implementation
 */
class DateRangeSearch {
  constructor(options) {
    this.options = options;
  }
  
  execute(index) {
    const results = new Set();
    const { type, year, endYear } = this.options;
    
    index.documents.forEach(doc => {
      if (!doc.start_year || !doc.end_year) {
        return; // Skip documents without date information
      }
      
      let matches = false;
      
      switch (type) {
        case 'before':
          // Document end date is before the specified year
          matches = doc.end_year <= year;
          break;
        case 'after':
          // Document start date is after the specified year
          matches = doc.start_year >= year;
          break;
        case 'between':
          if (endYear === undefined) {
            matches = false;
            break;
          }
          
          // Document date range overlaps with specified range
          matches = (
            (doc.start_year <= year && doc.end_year >= year) || // Starts before, ends after
            (doc.start_year <= endYear && doc.end_year >= endYear) || // Starts before end, ends after end
            (doc.start_year >= year && doc.end_year <= endYear) // Contained within
          );
          break;
      }
      
      if (matches) {
        results.add(doc.id);
      }
    });
    
    return results;
  }
}

/**
 * Boolean search implementation for combining operations
 */
class BooleanSearch {
  constructor(operation1, operation2, operator) {
    this.operation1 = operation1;
    this.operation2 = operation2;
    this.operator = operator;
  }
  
  execute(index) {
    const results1 = this.operation1.execute(index);
    const results2 = this.operation2.execute(index);
    
    switch (this.operator) {
      case 'AND': {
        // Intersection of both result sets
        const intersection = new Set();
        for (const id of results1) {
          if (results2.has(id)) {
            intersection.add(id);
          }
        }
        return intersection;
      }
      case 'OR': {
        // Union of both result sets
        const union = new Set(results1);
        for (const id of results2) {
          union.add(id);
        }
        return union;
      }
      case 'NOT': {
        // Items in results1 that are not in results2
        const difference = new Set(results1);
        for (const id of results2) {
          difference.delete(id);
        }
        return difference;
      }
      default:
        return results1;
    }
  }
}

/**
 * Main search manager class
 */
class ManuscriptSearch {
  constructor(index) {
    this.index = index;
  }
  
  search(query) {
    let resultIds;
    
    if (!query.operations || query.operations.length === 0) {
      // Return all documents if no operations specified
      resultIds = new Set(this.index.documents.map(doc => doc.id));
    } else if (query.operations.length === 1) {
      // Simple case: just execute the single operation
      resultIds = query.operations[0].execute(this.index);
    } else {
      // Multiple operations: combine them using the specified operator
      const [firstOp, ...restOps] = query.operations;
      resultIds = firstOp.execute(this.index);
      
      const operator = query.operator || 'AND';
      
      for (const op of restOps) {
        const opResults = op.execute(this.index);
        
        switch (operator) {
          case 'AND': {
            // Keep only IDs that are in both sets
            const intersection = new Set();
            for (const id of resultIds) {
              if (opResults.has(id)) {
                intersection.add(id);
              }
            }
            resultIds = intersection;
            break;
          }
          case 'OR': {
            // Add all IDs from the new operation
            for (const id of opResults) {
              resultIds.add(id);
            }
            break;
          }
          case 'NOT': {
            // Remove IDs that are in the new operation
            for (const id of opResults) {
              resultIds.delete(id);
            }
            break;
          }
        }
      }
    }
    
    // Convert IDs to actual document objects
    const idToDocMap = new Map(
      this.index.documents.map(doc => [doc.id, doc])
    );
    
    // Get all matching items
    const allMatchingItems = Array.from(resultIds)
      .map(id => idToDocMap.get(id))
      .filter(doc => doc !== undefined);
    
    // Calculate facet counts for the result set
    const facetCounts = this.calculateFacetCounts(allMatchingItems);
    
    return {
      total: allMatchingItems.length,
      items: allMatchingItems,
      facetCounts
    };
  }
  
  calculateFacetCounts(items) {
    const counts = {
      languages: {},
      material_keywords: {},
      script_keywords: {},
      repository: {}
    };
    
    // Count occurrences of each facet value in the result set
    items.forEach(item => {
      // Count languages
      if (item.languages) {
        item.languages.forEach(lang => {
          counts.languages[lang] = (counts.languages[lang] || 0) + 1;
        });
      }
      
      // Count material keywords
      if (item.material_keywords) {
        item.material_keywords.forEach(keyword => {
          counts.material_keywords[keyword] = (counts.material_keywords[keyword] || 0) + 1;
        });
      }
      
      // Count script keywords
      if (item.script_keywords) {
        item.script_keywords.forEach(keyword => {
          counts.script_keywords[keyword] = (counts.script_keywords[keyword] || 0) + 1;
        });
      }
      
      // Count repositories
      if (item.repository) {
        counts.repository[item.repository] = (counts.repository[item.repository] || 0) + 1;
      }
    });
    
    return counts;
  }
  
  // Helper methods to create search operations
  textSearch(options) {
    return new TextSearch(options);
  }
  
  facetSearch(options) {
    return new FacetSearch(options);
  }
  
  dateRangeSearch(options) {
    return new DateRangeSearch(options);
  }
  
  booleanSearch(op1, op2, operator) {
    return new BooleanSearch(op1, op2, operator);
  }
}

module.exports = {
  TextSearch,
  FacetSearch,
  DateRangeSearch,
  BooleanSearch,
  ManuscriptSearch
};