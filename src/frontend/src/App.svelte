<script>
  import Router from 'svelte-spa-router';
  import Banner from './lib/components/Banner.svelte';
  import Footer from './lib/components/Footer.svelte';
  import { onMount } from 'svelte';
  
  // Import route components
  import Home from './routes/Home.svelte';
  import ManuscriptsPage from './routes/manuscripts/+page.svelte';
  import NotFound from './routes/NotFound.svelte';
  import ManuscriptDetail from './routes/manuscripts/[id]/+page.svelte';
  import PagesView from './routes/manuscripts/[id]/pages/+page.svelte';
  import SinglePageView from './routes/manuscripts/[id]/pages/[pageNum]/+page.svelte';
  
  // Define routes
  const routes = {
    '/': Home,
    '/manuscripts': ManuscriptsPage,
    '/manuscripts/:id': ManuscriptDetail, // Manuscript detail page
    '/manuscripts/:id/pages': PagesView, // Pages navigator view
    '/manuscripts/:id/pages/:pageNum': SinglePageView, // Individual page view (now using dedicated component)
    '*': NotFound, // Catch-all for 404s
  };
  
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
      console.error('Error connecting to bucket:', e.message);
      bucketConnected = false;
    } finally {
      loading = false;
    }
  });
</script>

<div class="background" style="background-image: url('/background.png')"></div>
<main>
  <Banner />
  <div class="content">
    <Router {routes} />
  </div>
  <Footer />
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  
  .content {
    flex: 1;
    padding: 2rem;
  }
  
  :global(body) {
    margin: 0;
    font-family: 'EB Garamond', serif;
  }
  
  .background {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: -1;
    background-size: cover;
    background-position: center;
  }
</style>