<!-- <script>
    import { onMount } from 'svelte';
    import PageNavigator from '../../../../lib/components/PageNavigator.svelte';
    
    // Export the params prop that will be passed by the router
    export let params = {};
    
    let manuscriptId = '';
    let pageId = '';
    
    $: {
        // Update manuscriptId when params change
        manuscriptId = params.id || '';
        // Get pageNum if available
        pageId = params.pageNum || '';
    }
</script>

<div class="pages-container">
    {#if manuscriptId}
        <PageNavigator {manuscriptId} initialPageId={pageId} />
    {:else}
        <div class="error-message">
            <p>No manuscript ID provided</p>
            <a href="/#/manuscripts" class="back-link">← Back to Manuscripts</a>
        </div>
    {/if}
</div>

<style>
    .pages-container {
        height: calc(100vh - 4rem);
        width: 100%;
        max-width: 100%;
        padding: 0;
        margin: 0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }
    
    .error-message {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        background: rgba(255, 255, 255, 0.9);
        border-radius: 8px;
        padding: 2rem;
    }
    
    .back-link {
        display: inline-block;
        color: #4a9eff;
        text-decoration: none;
        margin-top: 1rem;
    }
    
    .back-link:hover {
        text-decoration: underline;
    }
</style> -->