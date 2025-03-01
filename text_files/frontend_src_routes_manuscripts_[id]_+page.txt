<script>
    import ManuscriptInfoViewer from '../../../lib/components/ManuscriptInfoViewer.svelte';
    
    // Export the params prop that will be passed by the router
    export let params = {};
</script>

<div class="manuscript-container">
    <ManuscriptInfoViewer manuscriptId={params.id || ''} />
</div>

<style>
    .manuscript-container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 1rem;
    }
</style>