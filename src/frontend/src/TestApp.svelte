<script>
  // Minimal test component
  import { onMount } from 'svelte';
  
  let message = "Hello World";
  
  onMount(() => {
    console.log("Component mounted");
  });
</script>

<div>{message}</div>

<style>
  div {
    padding: 1rem;
    background-color: #f0f0f0;
  }
</style>