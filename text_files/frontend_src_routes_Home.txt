<script>
  import { onMount } from 'svelte';
  import SplashBox from '../lib/components/SplashBox.svelte';

  export let bucketConnected = false;
  export let loading = true;

  onMount(async () => {
    try {
      const response = await fetch('/api/bucket');
      if (!response.ok) {
        throw new Error('Failed to connect to bucket');
      }
      bucketConnected = true;
    } catch (e) {
      console.error('Error connecting to bucket:', e instanceof Error ? e.message : String(e));
      bucketConnected = false;
    } finally {
      loading = false;
    }
  });
</script>

<div class="container">
  <SplashBox {bucketConnected} {loading} />
</div>

<style>
  .container {
    display: flex;
    align-items: top;
    justify-content: center;
    width: 100%;
  }
</style>