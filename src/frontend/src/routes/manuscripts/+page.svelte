<script>
    import { onMount } from 'svelte';
    // import { location } from 'svelte-spa-router'; // Not used in SvelteKit
  
    // Search state
    let manuscripts = [];
    let totalManuscripts = 0;
    let facets = {}; // This is correct for storing current facet counts from API
    let loading = true;
    let error = null;
    let indexMetadata = null;
    
    // Pagination 
    let currentPage = 1;
    let pageSize = 20;
    let totalPages = 0;
    
    // Search parameters
    let searchQuery = "";
    let selectedFacets = {
      languages: { include: [], exclude: [] },
      material_keywords: { include: [], exclude: [] },
      script_keywords: { include: [], exclude: [] },
      repository: { include: [], exclude: [] },
      transcription_status: { include: [], exclude: [] }
    };
    
    // Available facet options from the index
    let availableFacets = {
      languages: [],
      material_keywords: [],
      script_keywords: [],
      repository: [],
      transcription_status: []
    };
  
    const transcriptionStatusOrder = ["Fully Transcribed", "Partially Transcribed", "Not Transcribed"];
    
    onMount(async () => {
      try {
        await loadIndexMetadata();
        await searchManuscripts();
      } catch (err) {
        console.error('Failed to initialize:', err);
        error = err.message || 'Failed to load manuscripts. Please try again later.';
        loading = false; // Ensure loading is false on init error
      }
    });
    
    async function loadIndexMetadata() {
      try {
        const response = await fetch('/api/search/index');
        if (!response.ok) {
          const errData = await response.json().catch(() => ({ message: response.statusText }));
          throw new Error(`Failed to fetch search index metadata: ${errData.message || response.statusText}`);
        }
        
        const data = await response.json();
        indexMetadata = data.metadata;
        
        if (data.facets) {
          // Make sure all expected keys are present in availableFacets
          // and sort them for consistent display order.
          availableFacets = {
              languages: (data.facets.languages || []).sort((a,b) => formatLanguage(a).localeCompare(formatLanguage(b))),
              material_keywords: (data.facets.material_keywords || []).sort(),
              script_keywords: (data.facets.script_keywords || []).sort(),
              repository: (data.facets.repository || []).sort(),
              transcription_status: data.facets.transcription_status 
                  ? transcriptionStatusOrder.filter(status => (data.facets.transcription_status || []).includes(status))
                  : []
          };
        } else {
          console.warn("No facets data received from /api/search/index. Initializing with empty arrays.");
          // Initialize with empty arrays if data.facets is not present
          Object.keys(availableFacets).forEach(key => {
              availableFacets[key] = [];
          });
        }
      } catch (err) { // Renamed from 'error' to 'err' to avoid conflict with outer 'error' variable
        console.error('Error fetching index metadata:', err);
        // Ensure availableFacets is empty arrays on error to prevent template issues
        Object.keys(availableFacets).forEach(key => {
              availableFacets[key] = [];
        });
        throw err; // Re-throw to be caught by onMount
      }
    }
    
    async function searchManuscripts() {
      loading = true;
      error = null; // Reset error at the start of a search
      
      try {
        const searchBody = {
          page: currentPage,
          limit: pageSize
        };
        
        if (searchQuery.trim()) {
          searchBody.text = {
            query: searchQuery,
            fields: ['title', 'shelfmark', 'authors', 'repository', 'brief', 'origin_location', 'contents_summary', 'historical_context'],
            matchType: 'contains'
          };
        }
        
        const facetsToAdd = {};
        let hasFacets = false;
        
        Object.entries(selectedFacets).forEach(([facetType, { include, exclude }]) => {
          if (include.length > 0 || exclude.length > 0) {
            facetsToAdd[facetType] = {};
            if (include.length > 0) {
              facetsToAdd[facetType].include = { values: include, matchType: 'any'};
            }
            if (exclude.length > 0) {
              facetsToAdd[facetType].exclude = { values: exclude, matchType: 'any'};
            }
            hasFacets = true;
          }
        });
        
        if (hasFacets) {
          searchBody.facets = facetsToAdd;
        }
        
        const response = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(searchBody)
        });
        
        if (!response.ok) {
          const errData = await response.json().catch(() => ({ message: response.statusText }));
          throw new Error(`Search request failed: ${errData.message || response.statusText}`);
        }
        
        const data = await response.json();
        
        manuscripts = data.items || [];
        totalManuscripts = data.total || 0;
        totalPages = data.totalPages || 0;
        facets = data.facetCounts || {}; // `facets` variable stores the counts
        
      } catch (err) { // Renamed from 'error' to 'err'
        console.error('Search error:', err);
        error = err.message || 'Failed to search manuscripts';
        // Clear data on error
        manuscripts = [];
        totalManuscripts = 0;
        totalPages = 0;
        facets = {};
      } finally {
        loading = false;
      }
    }
    
    function changePage(newPage) {
      if (newPage >= 1 && newPage <= (totalPages || 1) && newPage !== currentPage) {
        currentPage = newPage;
        searchManuscripts();
      }
    }
    
    function handleSearch() {
      currentPage = 1; 
      searchManuscripts();
    }
    
    function toggleFacet(facetType, value) {
      // Ensure the facetType exists in selectedFacets
      const currentGroup = selectedFacets[facetType] || { include: [], exclude: [] };
      const includeIndex = currentGroup.include.indexOf(value);
      const excludeIndex = currentGroup.exclude.indexOf(value);
      
      let newInclude = [...currentGroup.include];
      let newExclude = [...currentGroup.exclude];
      
      if (includeIndex === -1 && excludeIndex === -1) {
        newInclude.push(value);
      } else if (includeIndex !== -1) {
        newInclude = newInclude.filter(v => v !== value);
        newExclude.push(value);
      } else {
        newExclude = newExclude.filter(v => v !== value);
      }
      
      // This reassignment is key for Svelte's reactivity on the selectedFacets object
      selectedFacets = {
        ...selectedFacets,
        [facetType]: { include: newInclude, exclude: newExclude }
      };
      
      currentPage = 1; 
      searchManuscripts();
    }
    
    function clearFilters() {
      searchQuery = "";
      // This reassignment is key for Svelte's reactivity
      selectedFacets = {
        languages: { include: [], exclude: [] },
        material_keywords: { include: [], exclude: [] },
        script_keywords: { include: [], exclude: [] },
        repository: { include: [], exclude: [] },
        transcription_status: { include: [], exclude: [] }
      };
      currentPage = 1;
      searchManuscripts();
    }
    
    function getFacetCount(facetType, value) {
      // `facets` here refers to `currentFacetCounts` from the API response
      return facets[facetType]?.[value] || 0;
    }
    
    function formatLanguage(langCode) {
      if (indexMetadata?.language_metadata?.[langCode]) {
        const langInfo = indexMetadata.language_metadata[langCode];
        let displayName = langInfo.name || langCode;
        if (langInfo.is_historical) {
          displayName = `${displayName} (historical)`;
        }
        return displayName;
      }
      return langCode;
    }
    
    // `sortLanguages` is not strictly needed here if `availableFacets.languages` is sorted upon creation.
    // If used directly in template, it's fine:
    // {#each sortLanguages(availableFacets.languages) as lang (lang)}
  
    // `getFacetState` is not used if `componentState.facetStates` is used.
    // If reverting to direct class binding, this would be needed.
    // function getFacetState(facetType, value) {
    //   if (selectedFacets[facetType]?.include.includes(value)) return 'include';
    //   if (selectedFacets[facetType]?.exclude.includes(value)) return 'exclude';
    //   return '';
    // }
    
    let showFilters = false;
    function toggleFilters() { showFilters = !showFilters; }
    
    function hasActiveFilters() {
      return Object.values(selectedFacets).some(values => 
        (values.include && values.include.length > 0) || (values.exclude && values.exclude.length > 0)
      ) || searchQuery.trim() !== '';
    }
    
    let sortField = 'title'; 
    let sortDirection = 'asc'; 
    // $: sortKey = `${sortField}-${sortDirection}`; // This can be removed if manuscripts array is reassigned to trigger reactivity.
    
    function getSortedManuscripts(manuscriptsToSort) { // Renamed parameter
      if (!manuscriptsToSort || manuscriptsToSort.length === 0) return [];
      
      return [...manuscriptsToSort].sort((a, b) => {
        let valA, valB;
        
        switch (sortField) {
          case 'title':
            valA = (a.title || '').toLowerCase();
            valB = (b.title || '').toLowerCase();
            break;
          case 'date':
            valA = a.start_year === undefined || a.start_year === null ? (sortDirection === 'asc' ? Infinity : -Infinity) : a.start_year;
            valB = b.start_year === undefined || b.start_year === null ? (sortDirection === 'asc' ? Infinity : -Infinity) : b.start_year;
            break;
          case 'pages':
            valA = a.page_count === undefined || a.page_count === null ? (sortDirection === 'asc' ? Infinity : -Infinity) : a.page_count;
            valB = b.page_count === undefined || b.page_count === null ? (sortDirection === 'asc' ? Infinity : -Infinity) : b.page_count;
            break;
          case 'transcription_status': 
            const order = { "Fully Transcribed": 1, "Partially Transcribed": 2, "Not Transcribed": 3, "N/A": 4, "Unknown": 4 }; // Ensure N/A and Unknown are handled
            const defaultOrderValue = sortDirection === 'asc' ? 5 : 0; 
            valA = order[a.transcription_status] || defaultOrderValue;
            valB = order[b.transcription_status] || defaultOrderValue;
            break;
          default: // Fallback to title sort
            valA = (a.title || '').toLowerCase();
            valB = (b.title || '').toLowerCase();
        }
        
        let comparison = 0;
        if (valA < valB) comparison = -1;
        if (valA > valB) comparison = 1;
        return sortDirection === 'asc' ? comparison : -comparison;
      });
    }
    
    function handleSort(field) {
      // No need for setTimeout here, Svelte's reactivity should handle it.
      if (sortField === field) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortField = field;
        sortDirection = 'asc';
      }
      // Trigger re-render of the sorted list by reassigning manuscripts
      // This is only truly necessary if getSortedManuscripts isn't called directly in the #each block
      // but it's a safe way to ensure updates.
      manuscripts = [...manuscripts]; 
    }
      
    // The `componentState` derived variable is used by the template for facet UI states.
    // It must correctly derive states from `selectedFacets`.
    $: componentState = { 
      sortField, 
      sortDirection, 
      searchQuery,
      // selectedFacets, // No need to pass selectedFacets itself if facetStates derives from it
      manuscripts, // Pass for debugging if needed, but not directly used by facetStates
      showFilters,
      // This part is crucial for the checkbox UI.
      facetStates: Object.fromEntries(
        Object.entries(selectedFacets).flatMap(([type, facetGroup]) => {
          const groupStates = [];
          if (facetGroup && facetGroup.include) {
            groupStates.push(...facetGroup.include.map(val => [`${type}:${val}`, 'include']));
          }
          if (facetGroup && facetGroup.exclude) {
            groupStates.push(...facetGroup.exclude.map(val => [`${type}:${val}`, 'exclude']));
          }
          return groupStates;
        })
      )
    };
  </script>
  
  <div class="page-wrapper">
    <div class="manuscripts-container">
      <h1>Manuscript Collection</h1>
    
    <div class="search-filter-container">
      <div class="search-box">
        <input 
          type="text" 
          bind:value={searchQuery} 
          placeholder="Search titles, authors, repository..." 
          on:keyup={(e) => e.key === 'Enter' && handleSearch()}
          aria-label="Search manuscripts"
        />
        <div class="search-buttons">
          <button class="search-button" on:click={handleSearch}>Search</button>
          <button class="clear-button" on:click={clearFilters} title="Clear all search terms and filters">Clear Filters</button>
          <button class="toggle-button" on:click={toggleFilters} aria-expanded={showFilters}>
            {showFilters ? 'Hide Filters' : 'Show Filters'} {#if hasActiveFilters() && !showFilters}<span class="filter-dot active"></span>{/if}
          </button>
        </div>
      </div>
  
      <div class="results-summary">
        {#if !loading}
          <div class="results-info">
            <p>
              Showing {manuscripts.length} of {totalManuscripts} manuscript{totalManuscripts === 1 ? '' : 's'}.
              {#if totalPages > 0}Page {currentPage} of {totalPages || 1}.{/if}
            </p>
            {#if hasActiveFilters()}
              <span class="filter-indicator">Filters active</span>
            {/if}
          </div>
        {/if}
      </div>
      
      {#if showFilters}
      <hr class="divider" />
      <div class="filter-header">
        <h2>Filter By</h2>
        <div class="filter-hint">
          <small>Click items to cycle: No filter → Include (✓) → Exclude (✕) → No filter</small>
        </div>
      </div>
      
      <div class="filter-columns">
        <!-- Transcription Status -->
        <div class="filter-column">
          <h3>Transcription Status</h3>
          <div class="filter-scrollable"> {#key availableFacets.transcription_status.join(',')}
            {#if availableFacets.transcription_status && availableFacets.transcription_status.length > 0}
              {#each availableFacets.transcription_status as status (status)}
                {@const stateKey = `transcription_status:${status}`}
                {@const uiState = componentState.facetStates[stateKey] || ''}
                <div class="facet-item" on:click={() => toggleFacet('transcription_status', status)} title="Filter by transcription status: {status}">
                  <div class="facet-checkbox {uiState}">
                    {#if uiState === 'include'}✓{:else if uiState === 'exclude'}✕{/if}
                  </div>
                  <span class="facet-label">{status}</span>
                  <span class="facet-count">({getFacetCount('transcription_status', status)})</span>
                </div>
              {/each}
            {:else} <p class="no-options">N/A</p> {/if}
            {/key}
          </div>
        </div>
  
        <!-- Repository -->
        <div class="filter-column">
          <h3>Repository</h3>
          <div class="filter-scrollable"> {#key availableFacets.repository.join(',')}
            {#if availableFacets.repository && availableFacets.repository.length > 0}
              {#each availableFacets.repository as repo (repo)}
                {@const stateKey = `repository:${repo}`}
                {@const uiState = componentState.facetStates[stateKey] || ''}
                <div class="facet-item" on:click={() => toggleFacet('repository', repo)} title="Filter by repository: {repo}">
                  <div class="facet-checkbox {uiState}">
                    {#if uiState === 'include'}✓{:else if uiState === 'exclude'}✕{/if}
                  </div>
                  <span class="facet-label">{repo}</span>
                  <span class="facet-count">({getFacetCount('repository', repo)})</span>
                </div>
              {/each}
            {:else} <p class="no-options">N/A</p> {/if}
            {/key}
          </div>
        </div>
        
        <!-- Languages -->
        <div class="filter-column">
          <h3>Languages</h3>
          <div class="filter-scrollable"> {#key availableFacets.languages.join(',')}
             {#if availableFacets.languages && availableFacets.languages.length > 0}
              {#each availableFacets.languages as lang (lang)} <!-- Already sorted in loadIndexMetadata -->
                {@const stateKey = `languages:${lang}`}
                {@const uiState = componentState.facetStates[stateKey] || ''}
                <div class="facet-item" on:click={() => toggleFacet('languages', lang)} title="Filter by language: {formatLanguage(lang)}">
                  <div class="facet-checkbox {uiState}">
                    {#if uiState === 'include'}✓{:else if uiState === 'exclude'}✕{/if}
                  </div>
                  <span class="facet-label">{formatLanguage(lang)}</span>
                  <span class="facet-count">({getFacetCount('languages', lang)})</span>
                </div>
              {/each}
            {:else} <p class="no-options">N/A</p> {/if}
            {/key}
          </div>
        </div>
        
        <!-- Materials -->
        <div class="filter-column">
          <h3>Materials</h3>
          <div class="filter-scrollable"> {#key availableFacets.material_keywords.join(',')}
            {#if availableFacets.material_keywords && availableFacets.material_keywords.length > 0}
              {#each availableFacets.material_keywords as material (material)}
                {@const stateKey = `material_keywords:${material}`}
                {@const uiState = componentState.facetStates[stateKey] || ''}
                <div class="facet-item" on:click={() => toggleFacet('material_keywords', material)} title="Filter by material: {material}">
                  <div class="facet-checkbox {uiState}">
                    {#if uiState === 'include'}✓{:else if uiState === 'exclude'}✕{/if}
                  </div>
                  <span class="facet-label">{material}</span>
                  <span class="facet-count">({getFacetCount('material_keywords', material)})</span>
                </div>
              {/each}
            {:else} <p class="no-options">N/A</p> {/if}
            {/key}
          </div>
        </div>
        
        <!-- Scripts -->
        <div class="filter-column">
          <h3>Scripts</h3>
          <div class="filter-scrollable"> {#key availableFacets.script_keywords.join(',')}
            {#if availableFacets.script_keywords && availableFacets.script_keywords.length > 0}
              {#each availableFacets.script_keywords as script (script)}
                {@const stateKey = `script_keywords:${script}`}
                {@const uiState = componentState.facetStates[stateKey] || ''}
                <div class="facet-item" on:click={() => toggleFacet('script_keywords', script)} title="Filter by script: {script}">
                  <div class="facet-checkbox {uiState}">
                    {#if uiState === 'include'}✓{:else if uiState === 'exclude'}✕{/if}
                  </div>
                  <span class="facet-label">{script}</span>
                  <span class="facet-count">({getFacetCount('script_keywords', script)})</span>
                </div>
              {/each}
            {:else} <p class="no-options">N/A</p> {/if}
            {/key}
          </div>
        </div>
      </div>
      {/if}
    </div>
    
    <div class="manuscripts-layout">
      <div class="manuscripts-content">
        {#if loading}
          <div class="loading-state"><p>Loading manuscripts...</p></div>
        {:else if error}
          <div class="error-state">
              <p>Error loading manuscripts: {error}</p>
              <button on:click={() => { loadIndexMetadata().then(searchManuscripts); }}>Try Again</button>
          </div>
        {:else if manuscripts.length === 0}
          <div class="empty-state">
            <p>No manuscripts match your search criteria.</p>
            {#if hasActiveFilters()} <button on:click={clearFilters}>Clear Filters</button> {/if}
          </div>
        {:else}
          <div class="manuscripts-table-container">
            <table class="manuscripts-table">
              <thead>
                <tr>
                  <th class="thumbnail-header"></th>
                  <th class="sortable-header" on:click={() => handleSort('title')} aria-sort={sortField === 'title' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    Title <span class="sort-indicator">{sortField === 'title' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}</span>
                  </th>
                  <th>Languages</th>
                  <th class="sortable-header status-column" on:click={() => handleSort('transcription_status')} aria-sort={sortField === 'transcription_status' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      Status <span class="sort-indicator">{sortField === 'transcription_status' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}</span>
                  </th>
                  <th class="sortable-header date-column" on:click={() => handleSort('date')} aria-sort={sortField === 'date' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    Date <span class="sort-indicator">{sortField === 'date' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}</span>
                  </th>
                  <th class="sortable-header pages-column" on:click={() => handleSort('pages')} aria-sort={sortField === 'pages' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    Pages <span class="sort-indicator">{sortField === 'pages' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {#each getSortedManuscripts(manuscripts) as manuscript (manuscript.id)}
                  <tr>
                    <td class="thumbnail-cell">
                      <a href="/#/manuscripts/{manuscript.id}" aria-label="View manuscript {manuscript.title || manuscript.id}">
                        <img 
                          src="/api/manuscripts/{manuscript.id}/thumbnail" 
                          alt="Thumbnail for {manuscript.title || manuscript.id}" 
                          loading="lazy"
                         />
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
                          {#each manuscript.languages.slice(0,3) as lang (lang)}
                            <span class="language-tag" 
                                  class:historical={indexMetadata?.language_metadata?.[lang]?.is_historical}
                                  title={formatLanguage(lang)}>
                              {indexMetadata?.language_metadata?.[lang]?.name || lang}
                            </span>
                          {/each}
                          {#if manuscript.languages.length > 3}
                              <span class="language-tag more-indicator" title="{manuscript.languages.slice(3).map(l => formatLanguage(l)).join(', ')}">
                                  +{manuscript.languages.length - 3}
                              </span>
                          {/if}
                        </div>
                      {:else}
                        <span class="no-data">Unknown</span>
                      {/if}
                    </td>
                    <td class="status-column-data">
                      <span class="status-tag status-{manuscript.transcription_status?.toLowerCase().replace(/\s+/g, '-')}">
                        {manuscript.transcription_status || 'N/A'}
                      </span>
                    </td>
                    <td>{manuscript.date_range_text || 'Unknown'}</td>
                    <td class="pages-column-data">{manuscript.page_count === undefined || manuscript.page_count === null ? 'N/A' : manuscript.page_count}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          
          {#if totalPages > 1}
          <div class="pagination">
            <button class="pagination-button" disabled={currentPage === 1} on:click={() => changePage(1)} aria-label="Go to first page">First</button>
            <button class="pagination-button" disabled={currentPage === 1} on:click={() => changePage(currentPage - 1)} aria-label="Go to previous page">Previous</button>
            <span class="pagination-info">Page {currentPage} of {totalPages}</span>
            <button class="pagination-button" disabled={currentPage === totalPages} on:click={() => changePage(currentPage + 1)} aria-label="Go to next page">Next</button>
            <button class="pagination-button" disabled={currentPage === totalPages} on:click={() => changePage(totalPages)} aria-label="Go to last page">Last</button>
          </div>
          {/if}
        {/if}
      </div>
      </div>
    </div>
  </div>
  
  <style>
    .page-wrapper { padding: 1rem; min-height: 100vh; }
    .manuscripts-container {
      padding: 1.5rem;
      width: 100%;
      max-width: 1600px; 
      margin: 0 auto;
      background-color: rgba(255, 255, 255, 0.97);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      color: #2d3748;
    }
    
    h1 { margin-bottom: 1.5rem; text-align: center; font-size: 2rem; color: #1a202c; }
    h2 { font-size: 1.25rem; margin-bottom: 0.75rem; color: #2d3748; }
    h3 { font-size: 1rem; margin: 0.75rem 0 0.5rem; color: #4a5568; font-weight: 600;}
    
    .search-filter-container {
      margin-bottom: 1.5rem;
      background-color: #fff;
      padding: 1rem;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
    }
    
    .search-box { display: flex; gap: 0.75rem; margin-bottom: 0.75rem; align-items: center; }
    .search-buttons { display: flex; gap: 0.5rem; }
    .search-box input {
      flex-grow: 1;
      padding: 0.6rem 0.9rem;
      border: 1px solid #cbd5e0;
      border-radius: 6px;
      font-size: 0.9rem;
    }
    .search-box input:focus {
      outline: none; border-color: #4a5568; box-shadow: 0 0 0 2px rgba(74,85,104,0.2);
    }
    
    .search-button, .clear-button, .toggle-button {
      padding: 0.6rem 1rem;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      font-size: 0.85rem;
      transition: background-color 0.2s ease, box-shadow 0.2s ease;
      white-space: nowrap;
    }
    .search-button { background-color: #4a5568; color: white; }
    .search-button:hover { background-color: #2d3748; }
    .clear-button { background-color: #e2e8f0; color: #2d3748; }
    .clear-button:hover { background-color: #cbd5e0; }
    .toggle-button { background-color: #f7fafc; color: #4a5568; border: 1px solid #e2e8f0; }
    .toggle-button:hover { background-color: #e2e8f0; }
    .filter-dot { display: inline-block; width: 8px; height: 8px; background-color: #3182ce; border-radius: 50%; margin-left: 6px; vertical-align: middle;}
  
  
    .results-summary { font-size: 0.85rem; color: #4a5568; margin-bottom: 1rem; }
    .results-info { display: flex; justify-content: space-between; align-items: center; }
    .filter-indicator {
      background-color: #ebf4ff; color: #3182ce; padding: 0.2rem 0.4rem;
      border-radius: 4px; font-size: 0.75rem; font-weight: 500;
    }
    
    .divider { border: none; height: 1px; background-color: #e2e8f0; margin: 1rem 0; }
    .filter-header { margin-bottom: 0.5rem; }
    .filter-hint { margin-top: 0.25rem; font-size: 0.8rem; color: #718096; }
    
    .filter-columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-top: 0.5rem; } 
    .filter-column {}
    .filter-scrollable {
      max-height: 180px; overflow-y: auto; border: 1px solid #e2e8f0;
      border-radius: 4px; padding: 0.5rem; margin-top: 0.25rem; background-color: #fdfdfd;
    }
    .no-options { font-size: 0.85rem; color: #a0aec0; padding: 0.25rem; }
    
    .facet-item { display: flex; align-items: center; padding: 0.3rem 0.2rem; border-radius: 3px; cursor: pointer; user-select: none; } 
    .facet-item:hover { background-color: #edf2f7; }
    
    .facet-checkbox {
      width: 16px; height: 16px; min-width: 16px; border: 1.5px solid #a0aec0;
      border-radius: 3px; display: flex; align-items: center; justify-content: center;
      margin-right: 0.5rem; font-size: 10px; font-weight: bold; line-height: 1;
      transition: background-color 0.1s, border-color 0.1s;
    }
    .facet-checkbox.include { background-color: #3b82f6; border-color: #2563eb; color: white; }
    .facet-checkbox.exclude { background-color: #ef4444; border-color: #dc2626; color: white; }
    
    .facet-label { flex-grow: 1; font-size: 0.85rem; color: #2d3748; margin-right: 0.25rem; }
    .facet-count { font-size: 0.75rem; color: #718096; margin-left: auto; padding-left: 0.25rem;} 
    
    .manuscripts-layout { display: flex; flex-direction: column; }
    .manuscripts-content { width: 100%; }
    
    .loading-state, .error-state, .empty-state {
      padding: 2rem; text-align: center; margin: 1rem 0; background-color: #fff;
      border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .error-state p { color: #c53030; margin-bottom: 1rem; }
    .error-state button, .empty-state button {
      background-color: #4a5568; color:white; padding: 0.5rem 1rem; border-radius: 6px;
      border: none; cursor: pointer;
    }
    .error-state button:hover, .empty-state button:hover { background-color: #2d3748; }
    
    .manuscripts-table-container { overflow-x: auto; }
    .manuscripts-table {
      width: 100%; border-collapse: collapse; background-color: #fff;
      border-radius: 6px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.07);
      font-size: 0.9rem;
    }
    .manuscripts-table th {
      background-color: #f7fafc; padding: 0.6rem 0.75rem; text-align: left;
      font-weight: 600; border-bottom: 1px solid #e2e8f0; color: #4a5568;
      white-space: nowrap;
    }
    .manuscripts-table th:first-child, .manuscripts-table td:first-child { padding-left: 1rem; } /* Thumbnail padding */
    .manuscripts-table th.status-column, 
    .manuscripts-table th.pages-column,
    .manuscripts-table th.date-column { text-align: center !important; } /* Center align specific headers */
  
  
    .sortable-header { cursor: pointer; user-select: none; }
    .sortable-header:hover { background-color: #edf2f7; }
    .sort-indicator { display: inline-block; width: 1em; text-align: center; color: #718096;}
    
    .manuscripts-table td {
      padding: 0.6rem 0.75rem; border-bottom: 1px solid #e2e8f0; vertical-align: middle;
    }
    .manuscripts-table tr:last-child td { border-bottom: none; }
    .manuscripts-table tr:hover td { background-color: #f7fafc80; }
    
    .thumbnail-header { width: 70px; text-align: center !important; }
    .thumbnail-cell { width: 70px; text-align: center; }
    .thumbnail-cell img {
      width: 50px; height: 50px; object-fit: cover; border-radius: 4px;
      border: 1px solid #e2e8f0; display: block; margin: auto;
    }
    
    .manuscript-link { color: #2b6cb0; text-decoration: none; font-weight: 500; }
    .manuscript-link:hover { text-decoration: underline; color: #1a202c; }
    .manuscript-id { font-size: 0.75rem; color: #718096; margin-top: 0.15rem; }
    
    .language-list { display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; justify-content: flex-start; /* Align tags to the start for left-aligned cells */ }
    .manuscripts-table td:nth-child(3) { text-align: left; } /* Ensure Languages cell is left-aligned */
  
    .language-tag {
      font-size: 0.75rem; background-color: #e2e8f0; color: #4a5568;
      padding: 0.1rem 0.35rem; border-radius: 3px;
    }
    .language-tag.historical { background-color: #e9d8fd; color: #5b21b6; font-style: italic; }
    .more-indicator { font-style: italic; background-color: #f0f0f0; font-size: 0.7rem; padding: 0.1rem 0.3rem;}
    .no-data { color: #a0aec0; font-style: italic; font-size: 0.85rem; }
    
    .status-tag {
      font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius: 12px; 
      font-weight: 500; white-space: nowrap;
      display: inline-block;
      line-height: 1.2;
      text-align: center;
    }
    .status-fully-transcribed { background-color: #c6f6d5; color: #22543d; border: 1px solid #9ae6b4;}
    .status-partially-transcribed { background-color: #feebc8; color: #9c4221; border: 1px solid #fbd38d;}
    .status-not-transcribed { background-color: #fed7d7; color: #9b2c2c; border: 1px solid #feb2b2;}
    .status-n-a, .status-unknown { background-color: #e2e8f0; color: #4a5568; border: 1px solid #cbd5e0;} 
    
    .date-column { min-width: 90px; }
    .pages-column { min-width: 70px; text-align: center !important; }
    .status-column { min-width: 130px; text-align: center !important; } 
    .manuscripts-table td.pages-column-data, 
    .manuscripts-table td.status-column-data 
      { text-align: center !important; }
  
  
    .pagination { display: flex; justify-content: center; align-items: center; margin-top: 1.5rem; gap: 0.4rem; }
    .pagination-button {
      padding: 0.4rem 0.7rem; border: 1px solid #cbd5e0; background-color: white;
      border-radius: 4px; cursor: pointer; font-size: 0.85rem;
    }
    .pagination-button:disabled { opacity: 0.5; cursor: not-allowed; }
    .pagination-button:hover:not([disabled]) { background-color: #edf2f7; }
    .pagination-info { margin: 0 0.75rem; font-size: 0.9rem; color: #4a5568;}
    
    @media (max-width: 900px) { 
      .manuscripts-container { padding: 1rem; }
      .search-box { flex-direction: column; align-items: stretch; }
      .search-buttons { flex-wrap: wrap; }
      .search-button, .clear-button, .toggle-button { flex-basis: calc(50% - 0.25rem); }
      .toggle-button { flex-basis: 100%; margin-top: 0.5rem;}
      .filter-columns { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); } 
      .manuscripts-table { font-size: 0.85rem; }
      .manuscripts-table th, .manuscripts-table td { padding: 0.5rem; }
      .thumbnail-cell img { width: 40px; height: 40px; }
      .status-tag, .language-tag { font-size: 0.7rem; padding: 0.1rem 0.3rem;}
    }
  
    @media (max-width: 600px) { 
      .filter-columns { grid-template-columns: 1fr; } 
      .search-button, .clear-button { flex-basis: 100%; margin-bottom: 0.5rem;}
      .toggle-button { margin-top: 0; }
      .results-info { flex-direction: column; align-items: flex-start; gap: 0.25rem;}
      .pagination-button { padding: 0.3rem 0.6rem; font-size: 0.8rem;}
      .pagination-info { margin: 0 0.5rem; font-size: 0.85rem; }
      h1 {font-size: 1.5rem;}
      h3 {font-size: 0.9rem;}
      .facet-label {font-size: 0.8rem;}
    }
  </style>