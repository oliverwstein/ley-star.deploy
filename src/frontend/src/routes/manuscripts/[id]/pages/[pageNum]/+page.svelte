<script>
    import PageViewer from "../../../../../lib/components/PageViewer.svelte";
    import PageNavigator from "../../../../../lib/components/PageNavigator.svelte";
    
    // Export the params prop that will be passed by the router
    export let params = {};
</script>

<div class="page-container">
    <PageNavigator 
        manuscriptId={params.id || ''} 
        currentPage={parseInt(params.pageNum) || 1}
    />
    
    <PageViewer 
        manuscriptId={params.id || ''} 
        pageId={params.pageNum || ''}
    />
</div>

<style>
    .page-container {
        max-width: 1400px;
        margin: 0 auto;
        padding: 1rem;
    }
</style>