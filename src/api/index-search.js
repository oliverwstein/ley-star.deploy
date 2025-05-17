// JavaScript version of index-search.ts

/**
* Lightweight Client-Side Manuscript Search Module
 * ... (rest of the comments) ...
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
      const normalizedQuery = query.toLowerCase();
      
      index.documents.forEach(doc => {
        const matches = fields.some(field => {
          const value = doc[field];
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
        case 'exact': return normalizedValue === query;
        case 'contains': return normalizedValue.includes(query);
        case 'startsWith': return normalizedValue.startsWith(query);
        case 'fuzzy': return this.fuzzyMatch(normalizedValue, query);
        default: return normalizedValue.includes(query);
      }
    }
    
    fuzzyMatch(text, query) {
      if (text.includes(query)) return true;
      if (query.length <= 2) return text.includes(query);
      const words = text.toLowerCase().split(/\s+/);
      const queryLower = query.toLowerCase();
      for (const word of words) {
        if (word === queryLower) return true;
        if (word.length >= 4 && queryLower.length >= 3) {
          for (let i = 0; i < word.length; i++) {
            const candidate = word.substring(0, i) + word.substring(i + 1);
            if (candidate === queryLower) return true;
          }
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
        console.warn(`Facet type "${facetType}" not found in index.facets during FacetSearch.execute.`);
        return results; 
      }
      switch (matchType) {
        case 'any':
          values.forEach(value => {
            const docIds = facets[value];
            if (docIds) {
              docIds.forEach(id => results.add(id));
            }
          });
          break;
        case 'all':
          if (values.length === 0) return results;
          const potentialMatches = new Map();
          values.forEach(value => {
            const docIds = facets[value];
            if (docIds) {
              docIds.forEach(id => potentialMatches.set(id, (potentialMatches.get(id) || 0) + 1));
            }
          });
          potentialMatches.forEach((count, id) => {
            if (count === values.length) results.add(id);
          });
          break;
        case 'none':
          index.documents.forEach(doc => results.add(doc.id));
          values.forEach(value => {
            const docIds = facets[value];
            if (docIds) {
              docIds.forEach(id => results.delete(id));
            }
          });
          break;
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
        if (!doc.start_year || !doc.end_year) return;
        let matches = false;
        switch (type) {
          case 'before': matches = doc.end_year <= year; break;
          case 'after': matches = doc.start_year >= year; break;
          case 'between':
            if (endYear === undefined) break;
            matches = (doc.start_year <= year && doc.end_year >= year) ||
                      (doc.start_year <= endYear && doc.end_year >= endYear) ||
                      (doc.start_year >= year && doc.end_year <= endYear);
            break;
        }
        if (matches) results.add(doc.id);
      });
      return results;
    }
  }
  
  /**
   * Boolean search implementation
   */
  class BooleanSearch {
    constructor(operation1, operation2, operator) {
      this.operation1 = operation1; this.operation2 = operation2; this.operator = operator;
    }
    execute(index) {
      const results1 = this.operation1.execute(index);
      const results2 = this.operation2.execute(index);
      switch (this.operator) {
        case 'AND':
          const intersection = new Set();
          results1.forEach(id => { if (results2.has(id)) intersection.add(id); });
          return intersection;
        case 'OR':
          const union = new Set(results1);
          results2.forEach(id => union.add(id));
          return union;
        case 'NOT':
          const difference = new Set(results1);
          results2.forEach(id => difference.delete(id));
          return difference;
        default: return results1;
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
        resultIds = new Set(this.index.documents.map(doc => doc.id));
      } else if (query.operations.length === 1) {
        resultIds = query.operations[0].execute(this.index);
      } else {
        const [firstOp, ...restOps] = query.operations;
        resultIds = firstOp.execute(this.index);
        const operator = query.operator || 'AND';
        for (const op of restOps) {
          const opResults = op.execute(this.index);
          switch (operator) {
            case 'AND':
              const intersection = new Set();
              resultIds.forEach(id => { if (opResults.has(id)) intersection.add(id); });
              resultIds = intersection;
              break;
            case 'OR': opResults.forEach(id => resultIds.add(id)); break;
            case 'NOT': opResults.forEach(id => resultIds.delete(id)); break;
          }
        }
      }
      
      const idToDocMap = new Map(this.index.documents.map(doc => [doc.id, doc]));
      const allMatchingItems = Array.from(resultIds).map(id => idToDocMap.get(id)).filter(doc => doc !== undefined);
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
        repository: {},
        transcription_status: {} 
      };
      
      items.forEach(item => {
        if (item.languages && Array.isArray(item.languages)) {
          item.languages.forEach(lang => {
            counts.languages[lang] = (counts.languages[lang] || 0) + 1;
          });
        }
        if (item.material_keywords && Array.isArray(item.material_keywords)) {
          item.material_keywords.forEach(keyword => {
            counts.material_keywords[keyword] = (counts.material_keywords[keyword] || 0) + 1;
          });
        }
        if (item.script_keywords && Array.isArray(item.script_keywords)) {
          item.script_keywords.forEach(keyword => {
            counts.script_keywords[keyword] = (counts.script_keywords[keyword] || 0) + 1;
          });
        }
        if (item.repository && typeof item.repository === 'string') {
          counts.repository[item.repository] = (counts.repository[item.repository] || 0) + 1;
        }
        
        // --- CORRECTED SECTION for transcription_status ---
        if (item.transcription_status && typeof item.transcription_status === 'string') {
          counts.transcription_status[item.transcription_status] = 
              (counts.transcription_status[item.transcription_status] || 0) + 1;
        }
        // --- END CORRECTED SECTION ---
      });
      // console.log('Final facet counts being returned:', JSON.stringify(counts)); // For debugging
      return counts;
    }
    
    textSearch(options) { return new TextSearch(options); }
    facetSearch(options) { return new FacetSearch(options); }
    dateRangeSearch(options) { return new DateRangeSearch(options); }
    booleanSearch(op1, op2, operator) { return new BooleanSearch(op1, op2, operator); }
  }
  
  module.exports = {
    TextSearch,
    FacetSearch,
    DateRangeSearch,
    BooleanSearch,
    ManuscriptSearch
  };