<script>
  export let bucketConnected;
  export let loading;
</script>

<div class="info-wrapper">
  <div class="content">
    <div class="text-content">
      <p class="mb-6">
        Leystar is your portal to centuries of medieval and renaissance manuscripts, transforming static digital images into a living, searchable archive that reveals hidden connections across time.
        Unlike traditional manuscript databases, Leystar lets you search not just titles and metadata, but the actual content of pages—from main text to marginal notes—making it possible to trace ideas, phrases, and annotations across manuscripts spanning different centuries and collections.
        With multilingual search capabilities, you can search in modern English to find relevant passages even in Church Latin, Old French, or Middle English manuscripts.

        Or rather, you'll be able to once I add that functionality back in. Right now, you can search the metadata and see transcripts of transcribed texts.
      </p>
    </div>
    <div class="button-container">
      <a
        href="/#/manuscripts"
        class="explore-button"
        class:disabled={loading || !bucketConnected}
        aria-disabled={loading || !bucketConnected}
      >
        {#if loading}
          Connecting to bucket...
        {:else if !bucketConnected}
          Bucket unavailable
        {:else}
          Explore Manuscripts
        {/if}
      </a>
    </div>
  </div>
</div>

<style>
  .info-wrapper {
    width: 100%;
    padding: 0 1vw;
    box-sizing: border-box;
  }

  .content {
    width: 100%;
    background: rgba(245, 243, 232, 0.75);
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    padding: 2rem;
    box-sizing: border-box;
  }

  .text-content {
    font-size: 1.125rem;
    line-height: 1.6;
    color: #1a1a1a;
  }

  .button-container {
    text-align: center;
    margin-top: 2rem;
  }

  .explore-button {
    display: inline-block;
    background: #1a1a1a;
    color: #f5f3e8;
    padding: 0.75rem 1.5rem;
    border-radius: 4px;
    text-decoration: none;
    font-weight: 500;
    transition: background-color 0.2s ease;
    cursor: pointer;
  }

  .explore-button:hover:not(.disabled) {
    background: #333;
  }

  .explore-button.disabled {
    background: #999;
    color: #ccc;
    cursor: not-allowed;
    pointer-events: none;
  }
</style>