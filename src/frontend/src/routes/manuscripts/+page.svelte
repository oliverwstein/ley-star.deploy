<script>
  import { onMount } from 'svelte';
  import { location } from 'svelte-spa-router';
  
  // Search state
  let manuscripts = [];
  let totalManuscripts = 0;
  let facets = {};
  let loading = true;
  let error = null;
  let indexMetadata = null;
  
  // Pagination 
  let currentPage = 1;
  let pageSize = 20;
  let totalPages = 0;
  
  // Search parameters
  let searchQuery = "";
  // Store both included and excluded facets separately
  let selectedFacets = {
    languages: { include: [], exclude: [] },
    material_keywords: { include: [], exclude: [] },
    script_keywords: { include: [], exclude: [] },
    repository: { include: [], exclude: [] }
  };
  
  // Available facet options from the index
  let availableFacets = {
    languages: [],
    material_keywords: [],
    script_keywords: [],
    repository: []
  };
  
  // Initial loading of index metadata
  onMount(async () => {
    try {
      // First load metadata to get facet options
      await loadIndexMetadata();
      // Then load the first page of results
      await searchManuscripts();
    } catch (err) {
      console.error('Failed to initialize:', err);
      error = 'Failed to load manuscripts. Please try again later.';
      loading = false;
    }
  });
  
  // Load index metadata to get facet options
  async function loadIndexMetadata() {
    try {
      const response = await fetch('/api/search/index');
      if (!response.ok) {
        throw new Error('Failed to fetch search index');
      }
      
      const data = await response.json();
      indexMetadata = data.metadata;
      
      // Set available facets
      if (data.facets) {
        availableFacets = data.facets;
      }
      
    } catch (error) {
      console.error('Error fetching index metadata:', error);
      throw error;
    }
  }
  
  // Search manuscripts with current filters and pagination
  async function searchManuscripts() {
    loading = true;
    error = null;
    
    try {
      // Build search query
      const searchBody = {
        page: currentPage,
        limit: pageSize
      };
      
      // Add text search if query is not empty
      if (searchQuery.trim()) {
        searchBody.text = {
          query: searchQuery,
          fields: ['title', 'shelfmark', 'authors', 'repository', 'brief'],
          matchType: 'contains'
        };
      }
      
      // Add facet filters with both include and exclude
      const facetsToAdd = {};
      let hasFacets = false;
      
      Object.entries(selectedFacets).forEach(([facetType, { include, exclude }]) => {
        if (include.length > 0 || exclude.length > 0) {
          facetsToAdd[facetType] = {};
          
          // Handle included facets (OR within the same facet type)
          if (include.length > 0) {
            facetsToAdd[facetType].include = {
              values: include,
              matchType: 'any'
            };
          }
          
          // Handle excluded facets (NOT)
          if (exclude.length > 0) {
            facetsToAdd[facetType].exclude = {
              values: exclude,
              matchType: 'any'
            };
          }
          
          hasFacets = true;
        }
      });
      
      if (hasFacets) {
        searchBody.facets = facetsToAdd;
      }
      
      // Make the search request
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(searchBody)
      });
      
      if (!response.ok) {
        throw new Error('Search request failed');
      }
      
      const data = await response.json();
      
      // Update state with search results
      manuscripts = data.items || [];
      totalManuscripts = data.total || 0;
      totalPages = data.totalPages || 0;
      facets = data.facetCounts || {};
      
    } catch (err) {
      console.error('Search error:', err);
      error = err.message || 'Failed to search manuscripts';
    } finally {
      loading = false;
    }
  }
  
  // Handle page change
  function changePage(newPage) {
    if (newPage >= 1 && newPage <= totalPages) {
      currentPage = newPage;
      searchManuscripts();
    }
  }
  
  // Handle search query change
  function handleSearch() {
    currentPage = 1; // Reset to first page on new search
    searchManuscripts();
  }
  
  // Toggle a facet selection - cycles through three states: none -> include -> exclude -> none
  function toggleFacet(facetType, value) {
    const includeIndex = selectedFacets[facetType].include.indexOf(value);
    const excludeIndex = selectedFacets[facetType].exclude.indexOf(value);
    
    // Cycle through states: none -> include -> exclude -> none
    if (includeIndex === -1 && excludeIndex === -1) {
      // Not selected, add to include
      selectedFacets[facetType].include = [...selectedFacets[facetType].include, value];
    } else if (includeIndex !== -1) {
      // Currently included, move to exclude
      selectedFacets[facetType].include = selectedFacets[facetType].include.filter(v => v !== value);
      selectedFacets[facetType].exclude = [...selectedFacets[facetType].exclude, value];
    } else {
      // Currently excluded, remove completely
      selectedFacets[facetType].exclude = selectedFacets[facetType].exclude.filter(v => v !== value);
    }
    
    // Update the selection and search
    selectedFacets = {...selectedFacets};
    currentPage = 1; // Reset to first page when filters change
    searchManuscripts();
  }
  
  // Clear all filters
  function clearFilters() {
    searchQuery = "";
    selectedFacets = {
      languages: { include: [], exclude: [] },
      material_keywords: { include: [], exclude: [] },
      script_keywords: { include: [], exclude: [] },
      repository: { include: [], exclude: [] }
    };
    currentPage = 1;
    searchManuscripts();
  }
  
  // Get the count for a facet value from the facet counts
  function getFacetCount(facetType, value) {
    return facets[facetType]?.[value] || 0;
  }
  
  // Format language name for display
  function formatLanguage(langCode) {
    if (indexMetadata?.language_metadata?.[langCode]) {
      const langInfo = indexMetadata.language_metadata[langCode];
      let displayName = langInfo.name || langCode;
      
      // Add historical indicator if applicable
      if (langInfo.is_historical) {
        displayName = `${displayName} (historical)`;
      }
      
      return displayName;
    }
    return langCode;
  }
  
  // Sort languages by importance (hierarchical)
  function sortLanguages(languages) {
    if (!languages || !indexMetadata?.language_metadata) return languages;
    
    return [...languages].sort((a, b) => {
      const langA = indexMetadata.language_metadata[a];
      const langB = indexMetadata.language_metadata[b];
      
      // Historical languages come after modern ones
      if (langA?.is_historical && !langB?.is_historical) return 1;
      if (!langA?.is_historical && langB?.is_historical) return -1;
      
      // Otherwise sort by name
      return (langA?.name || a).localeCompare(langB?.name || b);
    });
  }
  
  // Check the state of a facet: 'include', 'exclude', or ''
  function getFacetState(facetType, value) {
    if (selectedFacets[facetType].include.includes(value)) {
      return 'include';
    } else if (selectedFacets[facetType].exclude.includes(value)) {
      return 'exclude';
    }
    return '';
  }
  
  // Filter visibility toggle
  let showFilters = false;
  
  function toggleFilters() {
    showFilters = !showFilters;
  }
  
  // Check if any filters are applied
  function hasActiveFilters() {
    return Object.values(selectedFacets).some(values => 
      values.include.length > 0 || values.exclude.length > 0
    ) || searchQuery.trim() !== '';
  }
  
  // Sorting functionality
  let sortField = 'title'; // Default sort by title
  let sortDirection = 'asc'; // Default sort direction
  $: sortKey = `${sortField}-${sortDirection}`; // Reactive value to trigger updates
  
  // Sort the manuscripts array
  function getSortedManuscripts(manuscripts) {
    if (!manuscripts || manuscripts.length === 0) return [];
    
    return [...manuscripts].sort((a, b) => {
      let valueA, valueB;
      
      // Get sort values based on field
      switch (sortField) {
        case 'title':
          valueA = a.title || '';
          valueB = b.title || '';
          break;
        case 'date':
          // Sort by start_year (oldest first in ascending)
          valueA = a.start_year || Number.MAX_SAFE_INTEGER;
          valueB = b.start_year || Number.MAX_SAFE_INTEGER;
          break;
        case 'pages':
          valueA = a.page_count || 0;
          valueB = b.page_count || 0;
          break;
        default:
          valueA = a.title || '';
          valueB = b.title || '';
      }
      
      // Compare values
      if (typeof valueA === 'string' && typeof valueB === 'string') {
        // String comparison
        const result = valueA.localeCompare(valueB);
        return sortDirection === 'asc' ? result : -result;
      } else {
        // Numeric comparison
        const result = valueA - valueB;
        return sortDirection === 'asc' ? result : -result;
      }
    });
  }
  
  // Handle sort by clicking on table headers
  function handleSort(field) {
    // Create local variables to avoid reactivity issues
    let newDirection, newField;
    
    if (sortField === field) {
      // If already sorting by this field, toggle direction
      newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      newField = field;
    } else {
      // Otherwise, set new sort field and reset direction to asc
      newField = field;
      newDirection = 'asc';
    }
    
    // Reset all state variables with a slight delay to ensure UI update
    setTimeout(() => {
      sortField = newField;
      sortDirection = newDirection;
      
      // Force a re-render of the sorted manuscripts
      manuscripts = [...manuscripts];
    }, 0);
  }
  
  // Get sort indicator for a column
  function getSortIndicator(field) {
    if (sortField !== field) return '';
    return sortDirection === 'asc' ? '↑' : '↓';
  }
  
  // Create a reactive variable for the whole component state to force updates
  $: componentState = { 
    sortField, 
    sortDirection, 
    searchQuery,
    selectedFacets,
    manuscripts,
    showFilters,
    facetStates: Object.fromEntries(
      Object.entries(selectedFacets).flatMap(([type, {include, exclude}]) => 
        [...include.map(val => [`${type}:${val}`, 'include']), 
         ...exclude.map(val => [`${type}:${val}`, 'exclude'])]
      )
    )
  };
</script>

<div class="page-wrapper">
  <div class="manuscripts-container">
    <h1>Manuscript Collection</h1>
  
  <!-- Combined search and filter container -->
  <div class="search-filter-container">
    <!-- Text search input -->
    <div class="search-box">
      <input 
        type="text" 
        bind:value={searchQuery} 
        placeholder="Search manuscript titles, authors, repository..." 
        on:keyup={(e) => e.key === 'Enter' && handleSearch()}
      />
      <div class="search-buttons">
        <button class="search-button" on:click={handleSearch}>Search</button>
        <button class="clear-button" on:click={clearFilters}>Clear Filters</button>
        <button class="toggle-button" on:click={toggleFilters}>
          {showFilters ? 'Hide Filters' : 'Show Filters'}
        </button>
      </div>
    </div>

    <!-- Results summary -->
    <div class="results-summary">
      {#if !loading}
        <div class="results-info">
          <p>Showing {manuscripts.length} of {totalManuscripts} manuscripts</p>
          {#if hasActiveFilters()}
            <span class="filter-indicator">Filters active</span>
          {/if}
        </div>
      {/if}
    </div>
    
    {#if showFilters}
    <hr class="divider" />
    
    <!-- Filter section header -->
    <div class="filter-header">
      <h2>Filter By</h2>
      <div class="filter-hint">
        <small>Click on checkboxes to include (✓) or exclude (✕) attributes</small>
      </div>
    </div>
    
    <!-- Filter columns -->
    <div class="filter-columns">
      <!-- Repository filters -->
      <div class="filter-column">
        <h3>Repository</h3>
        <div class="filter-scrollable">
          {#if availableFacets.repository}
            {#each availableFacets.repository as repo}
              <div class="facet-item">
                <label class:selected-include={componentState.facetStates[`repository:${repo}`] === 'include'} 
                       class:selected-exclude={componentState.facetStates[`repository:${repo}`] === 'exclude'}>
                  <div class="facet-checkbox" 
                       class:include={componentState.facetStates[`repository:${repo}`] === 'include'}
                       class:exclude={componentState.facetStates[`repository:${repo}`] === 'exclude'}
                       on:click={() => toggleFacet('repository', repo)}>
                    {#if componentState.facetStates[`repository:${repo}`] === 'include'}
                      <span class="checkbox-icon">✓</span>
                    {:else if componentState.facetStates[`repository:${repo}`] === 'exclude'}
                      <span class="checkbox-icon">✕</span>
                    {/if}
                  </div>
                  <span class="facet-label">{repo}</span>
                  <span class="facet-count">{getFacetCount('repository', repo)}</span>
                </label>
              </div>
            {/each}
          {/if}
        </div>
      </div>
      
      <!-- Language filters -->
      <div class="filter-column">
        <h3>Languages</h3>
        <div class="filter-scrollable">
          {#if availableFacets.languages}
            {#each [...availableFacets.languages].sort((a, b) => {
                const nameA = indexMetadata?.language_metadata?.[a]?.name || a;
                const nameB = indexMetadata?.language_metadata?.[b]?.name || b;
                return nameA.localeCompare(nameB);
              }) as lang}
              <div class="facet-item">
                <label class:selected-include={componentState.facetStates[`languages:${lang}`] === 'include'} 
                       class:selected-exclude={componentState.facetStates[`languages:${lang}`] === 'exclude'}>
                  <div class="facet-checkbox" 
                       class:include={componentState.facetStates[`languages:${lang}`] === 'include'}
                       class:exclude={componentState.facetStates[`languages:${lang}`] === 'exclude'}
                       on:click={() => toggleFacet('languages', lang)}>
                    {#if componentState.facetStates[`languages:${lang}`] === 'include'}
                      <span class="checkbox-icon">✓</span>
                    {:else if componentState.facetStates[`languages:${lang}`] === 'exclude'}
                      <span class="checkbox-icon">✕</span>
                    {/if}
                  </div>
                  <span class="facet-label">{formatLanguage(lang)}</span>
                  <span class="facet-count">{getFacetCount('languages', lang)}</span>
                </label>
              </div>
            {/each}
          {/if}
        </div>
      </div>
      
      <!-- Material filters -->
      <div class="filter-column">
        <h3>Materials</h3>
        <div class="filter-scrollable">
          {#if availableFacets.material_keywords}
            {#each availableFacets.material_keywords as material}
              <div class="facet-item">
                <label class:selected-include={componentState.facetStates[`material_keywords:${material}`] === 'include'} 
                       class:selected-exclude={componentState.facetStates[`material_keywords:${material}`] === 'exclude'}>
                  <div class="facet-checkbox" 
                       class:include={componentState.facetStates[`material_keywords:${material}`] === 'include'}
                       class:exclude={componentState.facetStates[`material_keywords:${material}`] === 'exclude'}
                       on:click={() => toggleFacet('material_keywords', material)}>
                    {#if componentState.facetStates[`material_keywords:${material}`] === 'include'}
                      <span class="checkbox-icon">✓</span>
                    {:else if componentState.facetStates[`material_keywords:${material}`] === 'exclude'}
                      <span class="checkbox-icon">✕</span>
                    {/if}
                  </div>
                  <span class="facet-label">{material}</span>
                  <span class="facet-count">{getFacetCount('material_keywords', material)}</span>
                </label>
              </div>
            {/each}
          {/if}
        </div>
      </div>
      
      <!-- Script filters -->
      <div class="filter-column">
        <h3>Scripts</h3>
        <div class="filter-scrollable">
          {#if availableFacets.script_keywords}
            {#each availableFacets.script_keywords as script}
              <div class="facet-item">
                <label class:selected-include={componentState.facetStates[`script_keywords:${script}`] === 'include'} 
                       class:selected-exclude={componentState.facetStates[`script_keywords:${script}`] === 'exclude'}>
                  <div class="facet-checkbox" 
                       class:include={componentState.facetStates[`script_keywords:${script}`] === 'include'}
                       class:exclude={componentState.facetStates[`script_keywords:${script}`] === 'exclude'}
                       on:click={() => toggleFacet('script_keywords', script)}>
                    {#if componentState.facetStates[`script_keywords:${script}`] === 'include'}
                      <span class="checkbox-icon">✓</span>
                    {:else if componentState.facetStates[`script_keywords:${script}`] === 'exclude'}
                      <span class="checkbox-icon">✕</span>
                    {/if}
                  </div>
                  <span class="facet-label">{script}</span>
                  <span class="facet-count">{getFacetCount('script_keywords', script)}</span>
                </label>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>
    {/if}
  </div>
  
  <div class="manuscripts-layout">
    <!-- Main content area with manuscripts table -->
    <div class="manuscripts-content">
      {#if loading}
        <div class="loading-state">
          <p>Loading manuscripts...</p>
        </div>
      {:else if error}
        <div class="error-state">
          <p>Error: {error}</p>
          <button on:click={searchManuscripts}>Try Again</button>
        </div>
      {:else if manuscripts.length === 0}
        <div class="empty-state">
          <p>No manuscripts match your search criteria.</p>
          <button on:click={clearFilters}>Clear Filters</button>
        </div>
      {:else}
        <div class="manuscripts-table-container">
          <table class="manuscripts-table">
            <thead>
              <tr>
                <th class="thumbnail-header"></th>
                <th class="sortable-header" on:click={() => handleSort('title')}>
                  Title 
                  {#if sortField === 'title'}
                    <span class="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  {:else}
                    <span class="sort-indicator"></span>
                  {/if}
                </th>
                <th>Languages</th>
                <th class="sortable-header" on:click={() => handleSort('date')}>
                  Date 
                  {#if sortField === 'date'}
                    <span class="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  {:else}
                    <span class="sort-indicator"></span>
                  {/if}
                </th>
                <th class="sortable-header pages-column" on:click={() => handleSort('pages')}>
                  Pages 
                  {#if sortField === 'pages'}
                    <span class="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  {:else}
                    <span class="sort-indicator"></span>
                  {/if}
                </th>
              </tr>
            </thead>
            <tbody>
              {#each getSortedManuscripts(manuscripts) as manuscript}
                <tr>
                  <td class="thumbnail-cell">
                    <a href="/#/manuscripts/{manuscript.id}">
                      <img src="/api/manuscripts/{manuscript.id}/thumbnail" alt="Thumbnail" />
                    </a>
                  </td>
                  <td>
                    <a href="/#/manuscripts/{manuscript.id}" class="manuscript-link">
                      {manuscript.title || 'Untitled Manuscript'}
                    </a>
                    <div class="manuscript-id">{manuscript.id}</div>
                  </td>
                  <td>
                    {#if manuscript.languages && manuscript.languages.length > 0}
                      <div class="language-list">
                        {#each sortLanguages(manuscript.languages) as lang}
                          <span class="language-tag" 
                                class:historical={indexMetadata?.language_metadata?.[lang]?.is_historical}
                                title={lang}>
                            {formatLanguage(lang)}
                          </span>
                        {/each}
                      </div>
                    {:else}
                      <span class="no-data">Unknown</span>
                    {/if}
                  </td>
                  <td>{manuscript.date_range_text || 'Unknown'}</td>
                  <td>{manuscript.page_count || 'Unknown'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        
        <!-- Pagination controls -->
        <div class="pagination">
          <button 
            class="pagination-button" 
            disabled={currentPage === 1} 
            on:click={() => changePage(1)}
          >
            First
          </button>
          <button 
            class="pagination-button" 
            disabled={currentPage === 1} 
            on:click={() => changePage(currentPage - 1)}
          >
            Previous
          </button>
          
          <span class="pagination-info">Page {currentPage} of {totalPages}</span>
          
          <button 
            class="pagination-button" 
            disabled={currentPage === totalPages} 
            on:click={() => changePage(currentPage + 1)}
          >
            Next
          </button>
          <button 
            class="pagination-button" 
            disabled={currentPage === totalPages} 
            on:click={() => changePage(totalPages)}
          >
            Last
          </button>
        </div>
      {/if}
    </div>
    </div>
  </div>
</div>

<style>
  .page-wrapper {
    padding: 2rem;
    min-height: 100vh;
  }
  .manuscripts-container {
    padding: 2rem;
    width: 100%;
    max-width: 1600px;
    margin: 0 auto;
    background-color: rgba(255, 255, 255, 0.95);
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }
  
  h1 {
    margin-bottom: 1.5rem;
    text-align: center;
  }
  
  h2 {
    font-size: 1.4rem;
    margin-bottom: 1rem;
  }
  
  h3 {
    font-size: 1.1rem;
    margin: 0.5rem 0;
  }
  
  .search-filter-container {
    margin-bottom: 2rem;
    background-color: white;
    padding: 1.5rem;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }
  
  .search-box {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  
  .search-buttons {
    display: flex;
    gap: 0.5rem;
  }
  
  .search-box input {
    flex: 1;
    padding: 0.75rem 1rem;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05) inset;
  }
  
  .search-box input:focus {
    outline: none;
    border-color: #4a5568;
    box-shadow: 0 0 0 3px rgba(74, 85, 104, 0.2);
  }
  
  .search-button, .clear-button, .toggle-button {
    padding: 0.75rem 1.25rem;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s ease;
  }
  
  .search-button {
    background-color: #4a5568;
    color: white;
  }
  
  .search-button:hover {
    background-color: #2d3748;
  }
  
  .clear-button {
    background-color: #e2e8f0;
    color: #2d3748;
  }
  
  .clear-button:hover {
    background-color: #cbd5e0;
  }
  
  .toggle-button {
    background-color: #edf2f7;
    color: #4a5568;
    border: 1px solid #e2e8f0;
  }
  
  .toggle-button:hover {
    background-color: #e2e8f0;
  }
  
  .results-summary {
    font-size: 0.9rem;
    color: #666;
    margin-bottom: 1rem;
  }
  
  .results-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .filter-indicator {
    background-color: #ebf4ff;
    color: #3182ce;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 500;
  }
  
  .divider {
    border: none;
    height: 1px;
    background-color: #e5e7eb;
    margin: 1.5rem 0;
  }
  
  .filter-header {
    margin-bottom: 1rem;
  }
  
  .filter-header h2 {
    margin: 0;
    font-size: 1.25rem;
  }
  
  .filter-hint {
    margin-top: 0.5rem;
    font-size: 0.9rem;
    color: #6b7280;
  }
  
  .filter-columns {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    margin-top: 1rem;
  }
  
  .filter-column {
    flex: 1;
    min-width: 200px;
  }
  
  .filter-scrollable {
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    padding: 0.5rem;
    margin-top: 0.5rem;
  }
  
  .facet-item {
    margin-bottom: 0.25rem;
  }
  
  .facet-item label {
    display: flex;
    align-items: center;
    padding: 0.25rem;
    border-radius: 4px;
    cursor: pointer;
  }
  
  .facet-item label:hover {
    background-color: #f3f4f6;
  }
  
  .facet-item label.selected-include {
    background-color: #e5e7eb;
  }
  
  .facet-item label.selected-exclude {
    background-color: #fee2e2;
  }
  
  .facet-checkbox {
    width: 18px;
    height: 18px;
    min-width: 18px; /* Prevent shrinking */
    border: 1px solid #d1d5db;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    margin-right: 0.5rem;
    font-size: 12px;
    font-weight: bold;
  }
  
  .facet-checkbox.include {
    background-color: #3b82f6;
    border-color: #3b82f6;
    color: white;
  }
  
  .facet-checkbox.exclude {
    background-color: #ef4444;
    border-color: #ef4444;
    color: white;
  }
  
  .checkbox-icon {
    line-height: 1;
  }
  
  .facet-label {
    flex: 1;
    margin-left: 0.5rem;
    font-size: 0.9rem;
  }
  
  .facet-count {
    font-size: 0.8rem;
    color: #6b7280;
    min-width: 2rem;
    text-align: right;
  }
  
  .manuscripts-layout {
    display: flex;
    flex-direction: column;
  }
  
  .manuscripts-content {
    width: 100%;
  }
  
  .loading-state, .error-state, .empty-state {
    padding: 3rem;
    text-align: center;
    margin: 1rem 0;
  }
  
  .loading-state {
    background-color: white;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }
  
  .error-state, .empty-state {
    background-color: white;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }
  
  .error-state p {
    color: #ef4444;
    margin-bottom: 1rem;
  }
  
  .manuscripts-table-container {
    overflow-x: auto;
  }
  
  .manuscripts-table {
    width: 100%;
    border-collapse: collapse;
    background-color: white;
    border-radius: 6px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }
  
  .manuscripts-table th {
    background-color: #f3f4f6;
    padding: 0.75rem;
    text-align: center;
    font-weight: 600;
    border-bottom: 2px solid #e5e7eb;
  }
  
  .sortable-header {
    cursor: pointer;
    position: relative;
    user-select: none;
    transition: background-color 0.2s ease;
  }
  
  .sortable-header:hover {
    background-color: #e5e7eb;
  }
  
  .sort-indicator {
    display: inline-block;
    width: 1rem;
    font-weight: bold;
    color: #4a5568;
  }
  
  .manuscripts-table td {
    padding: 0.75rem;
    border-bottom: 1px solid #e5e7eb;
    vertical-align: middle;
    background-color: white;
    text-align: center;
  }
  
  /* Title column cells should be left-aligned */
  .manuscripts-table td:nth-child(2) {
    text-align: left;
  }
  
  .manuscripts-table tr:hover td {
    background-color: #f9fafb;
  }
  
  .thumbnail-header {
    width: 80px;
    min-width: 80px;
  }
  
  .thumbnail-cell {
    width: 80px;
    min-width: 80px;
  }
  
  .pages-column {
    width: 100px;
    min-width: 100px;
  }
  
  .thumbnail-cell img {
    width: 60px;
    height: 60px;
    object-fit: cover;
    border-radius: 4px;
  }
  
  .manuscript-link {
    color: #2563eb;
    text-decoration: none;
    font-weight: 500;
    display: block;
  }
  
  .manuscript-link:hover {
    text-decoration: underline;
  }
  
  .manuscript-id {
    font-size: 0.8rem;
    color: #6b7280;
    margin-top: 0.25rem;
  }
  
  .language-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  
  .language-tag {
    font-size: 0.8rem;
    background-color: #e5e7eb;
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
    margin-right: 0.25rem;
    margin-bottom: 0.25rem;
  }
  
  .language-tag.historical {
    background-color: #ddd6fe; /* Light purple for historical languages */
    font-style: italic;
  }
  
  .no-data {
    color: #9ca3af;
    font-style: italic;
  }
  
  .pagination {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-top: 2rem;
    gap: 0.5rem;
  }
  
  .pagination-button {
    padding: 0.4rem 0.8rem;
    border: 1px solid #d1d5db;
    background-color: white;
    border-radius: 4px;
    cursor: pointer;
  }
  
  .pagination-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .pagination-info {
    margin: 0 1rem;
  }
  
  /* Responsive adjustments */
  @media (max-width: 900px) {
    .filter-columns {
      flex-direction: column;
      gap: 1rem;
    }
    
    .filter-column {
      width: 100%;
    }
    
    .filter-scrollable {
      max-height: 150px;
    }
    
    .search-box {
      flex-direction: column;
    }
    
    .search-buttons {
      display: flex;
      flex-wrap: wrap;
      width: 100%;
      gap: 0.5rem;
    }
    
    .search-button, .clear-button, .toggle-button {
      flex: 1 0 calc(50% - 0.25rem);
      padding: 0.75rem 0.5rem;
      text-align: center;
      min-width: 120px;
    }
    
    .toggle-button {
      flex: 1 0 100%;
    }
    
    .search-box input {
      margin-bottom: 0.5rem;
    }
    
    .manuscripts-container {
      padding: 1rem;
    }
    
    .search-filter-container {
      padding: 1rem;
    }
    
    .results-info {
      flex-wrap: wrap;
      justify-content: flex-start;
      gap: 0.5rem;
    }
  }
  
  /* Small mobile devices */
  @media (max-width: 480px) {
    .page-wrapper {
      padding: 0.5rem;
    }
    
    .manuscripts-container {
      padding: 0.75rem;
    }
  }
</style>