<script>
  import { onMount } from 'svelte';
  import { location } from 'svelte-spa-router';
  import { manuscriptsStore, loadManuscripts } from '../../lib/stores.js';
  
  // Subscribe to the manuscripts store
  $: manuscripts = $manuscriptsStore.manuscripts;
  $: loading = $manuscriptsStore.loading;
  $: error = $manuscriptsStore.error;
  
  onMount(() => {
    // Load manuscripts data if not already loaded
    loadManuscripts();
  });
</script>

<div class="manuscripts-container">
  <h1>Manuscripts</h1>
  
  {#if loading}
    <p>Loading manuscripts...</p>
  {:else if error}
    <p class="error">Error: {error}</p>
  {:else if manuscripts.length === 0}
    <p>No manuscripts found.</p>
  {:else}
    <div class="manuscript-grid">
      {#each manuscripts as manuscript}
        <a class="manuscript-card" href="/#/manuscripts/{manuscript}">
          <div class="manuscript-image">
            <img src="/api/manuscripts/{manuscript}/thumbnail" alt="Thumbnail for {manuscript}"/>
          </div>
          <div class="manuscript-title">
            <h2>{manuscript}</h2>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .manuscripts-container {
    padding: 1rem;
    width: 100%;
  }
  
  h1 {
    margin-bottom: 2rem;
    text-align: center;
  }
  
  .error {
    color: red;
  }
  
  .manuscript-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 2rem;
  }
  
  .manuscript-card {
    position: relative;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
    text-decoration: none;
    color: inherit;
    transition: transform 0.2s ease;
    height: 280px;
  }
  
  .manuscript-card:hover {
    transform: translateY(-5px);
  }
  
  .manuscript-image {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: #e0d8c5;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  
  .manuscript-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  .manuscript-title {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    background: rgba(0, 0, 0, 0.6);
    padding: 0.5rem 0;
  }
  
  h2 {
    padding: 0.5rem 1rem;
    margin: 0;
    font-size: 1.2rem;
    font-weight: 500;
    color: white;
    text-align: center;
  }
</style>