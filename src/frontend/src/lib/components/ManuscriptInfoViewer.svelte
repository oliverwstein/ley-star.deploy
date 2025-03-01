<script>
    // The component expects to receive a manuscript ID and will handle the data fetching
    export let manuscriptId = '';
    
    import { onMount } from 'svelte';
    
    let manuscript = null;
    let loading = true;
    let error = null;
    
    function formatDateRange(dateRange) {
        if (!dateRange) return '';
        const [start, end] = dateRange;
        return start === end ? `${start}` : `${start} - ${end}`;
    }

    function getDisplayAuthors(authors) {
        if (!authors || authors.length <= 2) return authors || [];
        return authors.slice(0, 2);
    }
    
    $: dateRange = manuscript ? formatDateRange(manuscript.date_range) : '';
    $: transcriptionProgress = manuscript && manuscript.total_pages && manuscript.transcribed_pages 
        ? Math.round((manuscript.transcribed_pages / manuscript.total_pages) * 100)
        : 0;

    onMount(async () => {
        if (!manuscriptId) {
            error = "Manuscript ID not provided";
            loading = false;
            return;
        }
        
        try {
            loading = true;
            // Fetch manuscript metadata
            const response = await fetch(`/api/manuscripts/${manuscriptId}`);
            
            if (!response.ok) {
                throw new Error('Failed to fetch manuscript data');
            }
            
            manuscript = await response.json();
            
            // If the API doesn't provide certain fields, set defaults
            if (!manuscript.authors) manuscript.authors = [];
            if (!manuscript.languages) manuscript.languages = [];
            if (!manuscript.themes) manuscript.themes = [];
            if (!manuscript.date_range) manuscript.date_range = [0, 0];
            if (!manuscript.title) manuscript.title = manuscriptId; // Use ID as title if none exists
            
        } catch (e) {
            console.error('Error fetching manuscript:', e);
            error = e.message;
        } finally {
            loading = false;
        }
    });
</script>

{#if loading}
    <div class="content-wrapper">
        <p>Loading manuscript data...</p>
    </div>
{:else if error}
    <div class="content-wrapper">
        <p class="error">Error: {error}</p>
    </div>
{:else if manuscript}
    <div class="content-wrapper">
        <div class="manuscript-info">
            <div class="title-section">
                <a href="/#/manuscripts" class="back-link">← All Manuscripts</a>
                <h1>{manuscript.title || manuscriptId}</h1>
                {#if manuscript.alternative_titles?.length}
                    <div class="alternative-titles">
                        <div class="title-preview">+ {manuscript.alternative_titles.length} alternative {manuscript.alternative_titles.length === 1 ? 'title' : 'titles'}</div>
                        <div class="title-popup">
                            <h4>Alternative Titles</h4>
                            <ul>
                                {#each manuscript.alternative_titles as title}
                                    <li>{title}</li>
                                {/each}
                            </ul>
                        </div>
                    </div>
                {/if}
                <div class="record-id">Record ID: {manuscriptId}</div>
            </div>

            <div class="info-section">
                <div class="info-grid">
                    {#if manuscript.date_range}
                        <div>
                            <span class="label">Date:</span>
                            <span>{dateRange}</span>
                        </div>
                    {/if}
                    {#if manuscript.origin_location}
                        <div>
                            <span class="label">Origin:</span>
                            <span>{manuscript.origin_location}</span>
                        </div>
                    {/if}
                    {#if manuscript.languages && manuscript.languages.length > 0}
                        <div>
                            <span class="label">Languages:</span>
                            <span>{manuscript.languages.join(', ')}</span>
                        </div>
                    {/if}
                    {#if manuscript.authors && manuscript.authors.length > 0}
                        <div class="authors-container">
                            <span class="label">Authors:</span>
                            <div class="authors-list">
                                {#each getDisplayAuthors(manuscript.authors) as author}
                                    <span class="author">{author}</span>
                                {/each}
                                {#if manuscript.authors.length > 2}
                                    <span class="more-authors">
                                        and {manuscript.authors.length - 2} more...
                                        <div class="authors-popup">
                                            <h4>All Authors</h4>
                                            {#each manuscript.authors as author}
                                                <div class="author">{author}</div>
                                            {/each}
                                        </div>
                                    </span>
                                {/if}
                            </div>
                        </div>
                    {/if}
                </div>

                <button class="index-button" aria-label="Show manuscript details">
                    <span class="info-icon">ⓘ</span>
                    <div class="index-popup">
                        <h4>Manuscript Details</h4>
                        <div class="index-content">
                            {#if manuscript.shelfmark}
                                <div>
                                    <span class="label">Shelfmark:</span>
                                    <span>{manuscript.shelfmark}</span>
                                </div>
                            {/if}
                            {#if manuscript.repository}
                                <div>
                                    <span class="label">Repository:</span>
                                    <span>{manuscript.repository}</span>
                                </div>
                            {/if}
                            {#if manuscript.provenance?.length}
                                <div>
                                    <span class="label">Provenance:</span>
                                    <ul>
                                        {#each manuscript.provenance as entry}
                                            <li>{entry}</li>
                                        {/each}
                                    </ul>
                                </div>
                            {/if}
                        </div>
                    </div>
                </button>
            </div>

            <div class="main-content">
                <div class="content-section">
                    <div class="content-card">
                        {#if manuscript.contents_summary}
                            <h3>Contents</h3>
                            <p>{manuscript.contents_summary}</p>
                        {/if}
                        
                        {#if manuscript.historical_context}
                            <h3>Historical Context</h3>
                            <p>{manuscript.historical_context}</p>
                        {/if}

                        {#if manuscript.themes?.length}
                            <div class="themes">
                                {#each manuscript.themes as theme}
                                    <span class="theme-tag">{theme}</span>
                                {/each}
                            </div>
                        {/if}
                    </div>

                    <!-- Transcription status section commented out as requested
                    <div class="info-card status-card">
                        <h3>Transcription Status</h3>
                        <div class="status-content">
                            <div class="progress-section">
                                <div class="progress-bar">
                                    <div 
                                        class="progress-fill"
                                        style="width: {transcriptionProgress}%"
                                    ></div>
                                </div>
                                <div class="progress-label">
                                    {transcriptionProgress}% Complete
                                </div>
                                <div class="status-details">
                                    {manuscript.transcribed_pages || 0} of {manuscript.total_pages || 0} pages transcribed
                                </div>
                            </div>
                        </div>
                    </div>
                    -->
                    
                    <!-- View pages button -->
                    <a href="/#/manuscripts/{manuscriptId}/pages/1" class="view-pages-btn">
                        View Manuscript Pages
                    </a>
                </div>

                <div class="side-info">
                    {#if manuscript.physical_description}
                        <div class="info-card physical-card">
                            <h3>Physical Description</h3>
                            <div class="physical-content">
                                <div class="physical-grid">
                                    {#if manuscript.physical_description.material}
                                        <div>
                                            <span class="label">Material:</span>
                                            <span>{manuscript.physical_description.material}</span>
                                        </div>
                                    {/if}
                                    {#if manuscript.physical_description.dimensions}
                                        <div>
                                            <span class="label">Dimensions:</span>
                                            <span>{manuscript.physical_description.dimensions}</span>
                                        </div>
                                    {/if}
                                    {#if manuscript.physical_description.script_type}
                                        <div>
                                            <span class="label">Script:</span>
                                            <span>{manuscript.physical_description.script_type}</span>
                                        </div>
                                    {/if}
                                    {#if manuscript.physical_description.layout?.columns_per_page}
                                        <div>
                                            <span class="label">Layout:</span>
                                            <span>{manuscript.physical_description.layout.columns_per_page} column(s), {manuscript.physical_description.layout.lines_per_page} lines</span>
                                        </div>
                                    {/if}
                                </div>
                                {#if manuscript.physical_description.condition || 
                                     (manuscript.physical_description.decoration && 
                                      (manuscript.physical_description.decoration.illuminations || 
                                       manuscript.physical_description.decoration.artistic_style)) || 
                                     (manuscript.physical_description.layout && 
                                      manuscript.physical_description.layout.ruling_pattern)}
                                    <div class="collapsible">
                                        <details>
                                            <summary>More Details</summary>
                                            <div class="details-content">
                                                {#if manuscript.physical_description.condition}
                                                    <p><strong>Condition:</strong> {manuscript.physical_description.condition}</p>
                                                {/if}
                                                {#if manuscript.physical_description.decoration}
                                                    {#if manuscript.physical_description.decoration.illuminations}
                                                        <p><strong>Decoration:</strong> {manuscript.physical_description.decoration.illuminations}</p>
                                                    {/if}
                                                    {#if manuscript.physical_description.decoration.artistic_style}
                                                        <p><strong>Style:</strong> {manuscript.physical_description.decoration.artistic_style}</p>
                                                    {/if}
                                                {/if}
                                                {#if manuscript.physical_description.layout?.ruling_pattern}
                                                    <p><strong>Ruling:</strong> {manuscript.physical_description.layout.ruling_pattern}</p>
                                                {/if}
                                            </div>
                                        </details>
                                    </div>
                                {/if}
                            </div>
                        </div>
                    {/if}
                    
                    <!-- First page preview removed as requested -->
                </div>
            </div>
        </div>
    </div>
{:else}
    <div class="content-wrapper">
        <p>No manuscript data found.</p>
    </div>
{/if}

<style>
    .content-wrapper {
        background: rgba(255, 255, 255, 0.9);
        border-radius: 8px;
        padding: 2rem;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        margin-bottom: 2rem;
    }

    .error {
        color: red;
        font-weight: bold;
    }

    .back-link {
        display: inline-block;
        color: #4a9eff;
        text-decoration: none;
        margin-bottom: 1rem;
        font-family: 'EB Garamond', serif;
    }

    .back-link:hover {
        text-decoration: underline;
    }

    .title-section {
        margin-bottom: 2rem;
    }

    h1 {
        font-size: 2.5rem;
        margin: 0 0 0.5rem 0;
        color: #1a1a1a;
    }

    .record-id {
        color: #4a5568;
        font-size: 0.875rem;
    }

    .alternative-titles {
        position: relative;
        display: inline-block;
    }

    .title-preview {
        color: #4a9eff;
        cursor: pointer;
        font-size: 0.875rem;
    }

    .title-popup {
        display: none;
        position: absolute;
        background: white;
        border: 1px solid #e2e8f0;
        padding: 1rem;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        z-index: 10;
        min-width: 200px;
    }

    .alternative-titles:hover .title-popup {
        display: block;
    }

    .info-section {
        display: flex;
        align-items: start;
        gap: 1rem;
        margin-bottom: 2rem;
    }

    .info-grid {
        flex: 1;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        background: rgba(245, 243, 232, 0.85);
        padding: 1rem;
        border-radius: 8px;
    }

    .authors-container {
        position: relative;
    }

    .authors-list {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .author {
        display: block;
    }

    .more-authors {
        color: #4a9eff;
        cursor: pointer;
        position: relative;
    }

    .authors-popup {
        display: none;
        position: absolute;
        left: 0;
        top: 100%;
        background: white;
        border: 1px solid #e2e8f0;
        padding: 1rem;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        z-index: 10;
        min-width: 200px;
    }

    .authors-popup h4 {
        margin: 0 0 0.5rem 0;
        color: #1a1a1a;
    }

    .more-authors:hover .authors-popup {
        display: block;
    }

    .label {
        color: #4a5568;
        font-size: 0.875rem;
        display: block;
        margin-bottom: 0.25rem;
    }

    .index-button {
        background: none;
        border: none;
        cursor: pointer;
        position: relative;
        padding: 0.5rem;
    }

    .info-icon {
        color: #4a9eff;
        font-size: 1.25rem;
    }

    .index-popup {
        display: none;
        position: absolute;
        right: 0;
        background: white;
        border: 1px solid #e2e8f0;
        padding: 1rem;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        z-index: 10;
        min-width: 300px;
    }

    .index-button:hover .index-popup {
        display: block;
    }

    .main-content {
        display: grid;
        grid-template-columns: 3fr 1fr;
        gap: 2rem;
    }

    .content-section {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .content-card, .info-card {
        background: white;
        padding: 1.5rem;
        border-radius: 8px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    h3 {
        margin: 0 0 1rem 0;
        color: #1a1a1a;
        font-size: 1.25rem;
    }

    .themes {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 1rem;
    }

    .theme-tag {
        background: #f0f7ff;
        color: #4a9eff;
        padding: 0.25rem 0.75rem;
        border-radius: 16px;
        font-size: 0.875rem;
    }

    .progress-section {
        margin-top: 1rem;
    }

    .progress-bar {
        width: 100%;
        height: 8px;
        background: #e2e8f0;
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 0.5rem;
    }

    .progress-fill {
        height: 100%;
        background: #4a9eff;
        transition: width 0.3s ease;
    }

    .progress-label {
        text-align: right;
        font-size: 0.875rem;
        color: #4a5568;
        margin-bottom: 0.25rem;
    }

    .status-details {
        font-size: 0.875rem;
        color: #4a5568;
    }

    .physical-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 1rem;
        margin-bottom: 1rem;
    }

    .collapsible details {
        margin-top: 1rem;
    }

    .collapsible summary {
        cursor: pointer;
        color: #4a9eff;
    }

    .details-content {
        margin-top: 1rem;
        padding: 1rem;
        background: #f8fafc;
        border-radius: 4px;
    }

    .details-content p {
        margin: 0.5rem 0;
    }
    
    .view-pages-btn {
        display: block;
        background: #4a9eff;
        color: white;
        text-align: center;
        padding: 0.75rem 1rem;
        border-radius: 8px;
        text-decoration: none;
        font-weight: 500;
        margin-top: 1rem;
        transition: background-color 0.2s ease;
    }
    
    .view-pages-btn:hover {
        background: #3182ce;
    }

    @media (max-width: 768px) {
        .main-content {
            grid-template-columns: 1fr;
        }

        .info-section {
            flex-direction: column;
        }

        .index-popup {
            right: auto;
            left: 0;
        }

        .content-section {
            order: 1;
        }

        .side-info {
            order: 2;
        }

        .authors-popup {
            left: auto;
            right: 0;
        }
    }
</style>