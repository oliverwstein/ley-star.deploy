<script>
  import { push } from 'svelte-spa-router';
</script>

<div class="not-found">
  <h1>Page Not Found</h1>
  <p>The page you're looking for doesn't exist or has been moved.</p>
  <button on:click={() => push('/')}>Return to Home</button>
</div>

<style>
  .not-found {
    text-align: center;
    background: rgba(245, 243, 232, 0.8);
    border-radius: 8px;
    padding: 2rem;
    margin: 2rem auto;
    max-width: 600px;
  }
  
  h1 {
    margin-bottom: 1rem;
  }
  
  button {
    margin-top: 1rem;
    padding: 0.5rem 1rem;
    background: #1a1a1a;
    color: #f5f3e8;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  
  button:hover {
    background: #333;
  }
</style>