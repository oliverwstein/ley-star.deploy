<script>
  import { onMount } from 'svelte';
  // @ts-ignore
  import { goto } from '$app/navigation';
    import SplashBox from '../lib/components/SplashBox.svelte';

  let bucketConnected = false;
  let loading = true;

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

  // @ts-ignore
  const handleEnter = () => {
    if (bucketConnected) {
      goto('/manuscripts');
    }
  };
</script>

<main class="container">
  <SplashBox {bucketConnected} {loading} />
</main>

<style>
  .container {
    min-height: 100vh;
    display: flex;
    align-items: top;
    justify-content: center;
  }
  
</style>