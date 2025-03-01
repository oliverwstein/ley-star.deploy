<script>
  import "../app.css";
  // @ts-ignore
  import Banner from '$lib/components/Banner.svelte';
  // @ts-ignore
  import Footer from '$lib/components/Footer.svelte';
</script>

<!-- Background Layer (Fixed) -->
<div class="background-layer">
  <img src="/background.png" alt="Background" />
</div>

<!-- Main Container (Scrollable) -->
<div class="container">
  <!-- Banner is now sticky, inside the container -->
  <Banner /> 

  <main class="main-content">
    <!-- This is where your page content goes -->
    <slot /> 
  </main>

  <!-- Footer is at the bottom of the container -->
  <Footer />  
</div>

<style>
  :global(body) {
    font-family: 'EB Garamond', serif;
    font-size: 1.125rem;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    margin: 0; /* Remove default body margin */
    overflow-x: hidden; /* Prevent horizontal scrollbar */
  }

  :global(h1, h2, h3, h4, h5, h6) {
    font-family: 'EB Garamond', serif;
    font-weight: 500;
    line-height: 1.2;
  }

  :global(button, input, select, textarea) {
    font-family: 'EB Garamond', serif;
  }

  .background-layer {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: -1; /* Behind everything */
    overflow: hidden;
  }

  .background-layer img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .container {
    position: relative; /* Important for z-index to work correctly */
    z-index: 1;      /* Above the background */
    display: flex;
    flex-direction: column;
    min-height: 100vh; /* Ensure it takes up at least the full viewport height */
    /* REMOVE min-width: 100vw;  It's not necessary and can cause issues */
    max-width: 100%; /* Prevent content from overflowing horizontally */
    overflow-x: hidden; /*Prevent horizontal scrollbar at this level too*/
  }

  .main-content {
    flex: 1; /* Grow to fill available space */
    padding: 2rem; /* Add some padding around the content */
    box-sizing: border-box;
  }
</style>