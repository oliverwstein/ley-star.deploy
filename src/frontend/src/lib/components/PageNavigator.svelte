<script>
    import { onMount, afterUpdate } from 'svelte';
    
    export let manuscriptId = '';
    export let currentPage = 1;
    
    let pageInput = currentPage;
    let totalPages = 1000; // Large default to avoid disabling next button prematurely
    let isLoading = true;

    // Update input value whenever current page changes (from parent component/URL)
    $: pageInput = currentPage;

    onMount(async () => {
        // Fetch manuscript metadata to get total pages for validation
        if (manuscriptId) {
            try {
                isLoading = true;
                // Fetch manuscript metadata
                const metadataResponse = await fetch(`/api/manuscripts/${manuscriptId}`);
                if (!metadataResponse.ok) {
                    throw new Error('Failed to fetch manuscript metadata');
                }
                const metadata = await metadataResponse.json();
                
                // Fallback if metadata doesn't have page count
                if (!metadata.page_count) {
                    // Fetch pages list to count them
                    const pagesResponse = await fetch(`/api/manuscripts/${manuscriptId}/pages`);
                    if (pagesResponse.ok) {
                        const pagesData = await pagesResponse.json();
                        totalPages = pagesData.pages?.length || 1000;
                    }
                } else {
                    totalPages = metadata.page_count;
                }
            } catch (error) {
                console.error('Error loading manuscript data:', error);
            } finally {
                isLoading = false;
            }
        }
    });

    function goToPage() {
        // Ensure input is a number and within valid range
        const page = parseInt(pageInput);
        if (!isNaN(page) && page >= 1) {
            window.location.href = `/#/manuscripts/${manuscriptId}/pages/${page}`;
        } else {
            // Reset input to current page if invalid
            pageInput = currentPage;
        }
    }

    function goToPreviousPage() {
        if (currentPage > 1) {
            window.location.href = `/#/manuscripts/${manuscriptId}/pages/${currentPage - 1}`;
        }
    }

    function goToNextPage() {
        window.location.href = `/#/manuscripts/${manuscriptId}/pages/${currentPage + 1}`;
    }
</script>

<div class="page-navigator">
    <button class="nav-button" on:click={goToPreviousPage} disabled={currentPage <= 1 || isLoading}>
        <span class="arrow">←</span>
    </button>
    
    <div class="page-input-container">
        <input 
            type="text" 
            bind:value={pageInput} 
            on:keypress={(e) => e.key === 'Enter' && goToPage()}
            class="page-input"
            disabled={isLoading}
        />
    </div>
    
    <button class="nav-button" on:click={goToNextPage} disabled={isLoading}>
        <span class="arrow">→</span>
    </button>
</div>

<style>
    .page-navigator {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        margin: 0.5rem 0 1.5rem 0;
        padding: 0.5rem;
        background-color: #f8f8f8;
        border-radius: 4px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    .nav-button {
        background-color: #f0f0f0;
        border: 1px solid #ccc;
        border-radius: 4px;
        padding: 0.5rem 1rem;
        cursor: pointer;
        transition: background-color 0.2s;
    }

    .nav-button:hover:not([disabled]) {
        background-color: #e0e0e0;
    }

    .nav-button[disabled] {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .arrow {
        font-size: 1.2rem;
        font-weight: bold;
    }

    .page-input-container {
        display: flex;
        align-items: center;
    }

    .page-input {
        width: 3rem;
        text-align: center;
        padding: 0.4rem;
        border: 1px solid #ccc;
        border-radius: 4px;
    }

    /* Remove unnecessary styles */
</style>