<script>
    import { onMount } from 'svelte';
    
    // Props
    export let manuscriptId = '';
    export let pageId = '';
    
    // State variables
    let image = null;
    let segmentation = null;
    let transcript = null;
    let hoveredSegment = null;
    let selectedSegment = null;
    let hoverPosition = { x: 0, y: 0 };
    let transcriptMap = {};
    let sortedTranscriptEntries = [];
    let imageSize = { width: 0, height: 0 };
    let isLoading = true;
    let error = null;
    let dataReady = false;
    let showTranslation = false; // Controls whether to show translation or transcription
    let manuscriptInfo = null; // Store manuscript metadata
    
    // Element references
    let imageRef;
    let containerRef;
    let transcriptPanelRef;
    let transcriptItemRefs = {};
    
    // Fetch manuscript metadata
    async function fetchManuscriptInfo() {
      try {
        const response = await fetch(`/api/manuscripts/${manuscriptId}`);
        if (!response.ok) {
          console.error(`Failed to fetch manuscript metadata: ${response.status} ${response.statusText}`);
          return null;
        }
        return await response.json();
      } catch (err) {
        console.error('Error fetching manuscript information:', err);
        return null;
      }
    }

    // Fetch data from the server
    async function fetchData() {
      isLoading = true;
      error = null;
      
      try {
        // Add cache-busting parameter to prevent browser caching
        const cacheBuster = Date.now();
        
        // Fetch image, segmentation, transcript, and manuscript info in parallel
        const [imageRes, segmentationRes, transcriptRes, manuscriptData] = await Promise.all([
          fetch(`/api/manuscripts/${manuscriptId}/pages/${pageId}/image?nocache=${cacheBuster}`),
          fetch(`/api/manuscripts/${manuscriptId}/pages/${pageId}/segmentation?nocache=${cacheBuster}`),
          fetch(`/api/manuscripts/${manuscriptId}/pages/${pageId}/transcript?nocache=${cacheBuster}`),
          fetchManuscriptInfo()
        ]);
        
        // Check for errors
        if (!imageRes.ok) throw new Error(`Failed to load image: ${imageRes.status} ${imageRes.statusText}`);
        if (!segmentationRes.ok) throw new Error(`Failed to load segmentation: ${segmentationRes.status} ${segmentationRes.statusText}`);
        if (!transcriptRes.ok) throw new Error(`Failed to load transcript: ${transcriptRes.status} ${transcriptRes.statusText}`);
        
        // Store manuscript information
        manuscriptInfo = manuscriptData;
        
        // Get image as blob and create object URL
        const imageBlob = await imageRes.blob();
        image = URL.createObjectURL(imageBlob);
        
        // Parse JSON responses
        segmentation = await segmentationRes.json();
        transcript = await transcriptRes.json();
  
        // Create mapping from segment IDs to transcript entries
        transcriptMap = {};
        
        // Process body text
        if (transcript.body) {
          transcript.body.forEach(entry => {
            if (entry.location) {
              transcriptMap[entry.location] = {
                ...entry,
                type: 'body'
              };
            }
          });
        }
        
        // Add illustrations if they exist
        if (transcript.illustrations) {
          transcript.illustrations.forEach(entry => {
            if (entry.location && !isNaN(entry.location)) {
              transcriptMap[entry.location] = {
                ...entry,
                text: entry.description,
                type: 'illustration'
              };
            }
          });
        }
        
        // Add marginalia if they exist
        if (transcript.marginalia) {
          transcript.marginalia.forEach(entry => {
            if (entry.location) {
              transcriptMap[entry.location] = {
                ...entry,
                type: 'marginalia'
              };
            }
          });
        }
        
        // Create sorted array of transcript entries for display
        sortedTranscriptEntries = Object.entries(transcriptMap)
          .map(([id, entry]) => ({id, ...entry}))
          .sort((a, b) => {
            // Sort numerically by ID if possible
            const numA = parseInt(a.id.replace(/\D/g, ''));
            const numB = parseInt(b.id.replace(/\D/g, ''));
            
            if (!isNaN(numA) && !isNaN(numB)) {
              return numA - numB;
            }
            
            // If numeric sorting fails, sort alphabetically
            return a.id.localeCompare(b.id);
          });
        
        dataReady = true;
      } catch (err) {
        console.error('Error fetching manuscript data:', err);
        error = err.message;
      } finally {
        isLoading = false;
      }
    }
    
    // Handle image load to set dimensions
    function handleImageLoad() {
      if (imageRef) {
        // Important: We need to wait for the browser to fully render the image
        setTimeout(() => {
          // Use the actual rendered dimensions of the image, not just the natural dimensions
          const rect = imageRef.getBoundingClientRect();
          imageSize = {
            width: imageRef.naturalWidth,
            height: imageRef.naturalHeight,
            displayWidth: rect.width,
            displayHeight: rect.height,
            scale: rect.width / imageRef.naturalWidth
          };
          console.log('Image loaded with dimensions:', imageSize);
        }, 0);
      }
    }
    
    // Track mouse position for hover tooltips
    function handleMouseMove(e) {
      if (containerRef) {
        const rect = containerRef.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Calculate the original coordinates in the image space
        const originalX = x / (imageSize.scale || 1);
        const originalY = y / (imageSize.scale || 1);
        
        hoverPosition = {
          x,
          y,
          originalX,
          originalY
        };
      }
    }
    
    // Handle container click (to deselect all)
    function handleContainerClick(e) {
      // If clicking outside of a segment, clear the selection
      if (e.target.tagName !== 'path') {
        selectedSegment = null;
      }
    }
    
    // Handle segment click in the image
    function handleSegmentClick(e, segmentId) {
      e.stopPropagation();
      if (transcriptMap[segmentId]) {
        selectedSegment = segmentId;
        
        // Scroll to the corresponding transcript entry
        scrollToTranscriptEntry(segmentId);
      }
    }
    
    // Handle transcript entry click
    function handleTranscriptClick(segmentId) {
      selectedSegment = segmentId;
      
      // Scroll to make sure the segment is visible in both panels
      scrollToTranscriptEntry(segmentId);
    }
    
    // Scroll to a transcript entry
    function scrollToTranscriptEntry(segmentId) {
      if (transcriptItemRefs[segmentId] && transcriptPanelRef) {
        const itemElement = transcriptItemRefs[segmentId];
        const panelElement = transcriptPanelRef;
        
        // Calculate scroll position to center the item in the panel
        const itemRect = itemElement.getBoundingClientRect();
        const panelRect = panelElement.getBoundingClientRect();
        
        const scrollTop = itemElement.offsetTop - panelElement.offsetTop - (panelRect.height / 2) + (itemRect.height / 2);
        
        // Smooth scroll to the item
        panelElement.scrollTo({
          top: Math.max(0, scrollTop),
          behavior: 'smooth'
        });
      }
    }
    
    // Handle mouse enter on transcript entry
    function handleTranscriptMouseEnter(segmentId) {
      hoveredSegment = segmentId;
    }
    
    // Handle mouse leave on transcript entry
    function handleTranscriptMouseLeave() {
      hoveredSegment = null;
    }
    
    // Fetch data when component mounts or when manuscriptId/pageId change
    $: if (manuscriptId && pageId) {
      fetchData();
    }
    
    onMount(() => {
      if (manuscriptId && pageId) {
        fetchData();
      }
      
      // Cleanup function for URL objects
      return () => {
        if (image && image.startsWith('blob:')) {
          URL.revokeObjectURL(image);
        }
      };
    });
  </script>
  
  <div class="manuscript-viewer">
    <div class="breadcrumbs">
      <a href="/#" class="breadcrumb-link">Home</a>
      <span class="breadcrumb-separator">›</span>
      <a href="/#/manuscripts" class="breadcrumb-link">Manuscripts</a>
      <span class="breadcrumb-separator">›</span>
      <a href="/#/manuscripts/{manuscriptId}" class="breadcrumb-link">
        {manuscriptInfo?.title || 'Manuscript Details'}
      </a>
      <span class="breadcrumb-separator">›</span>
      <span class="breadcrumb-current">Page {pageId}</span>
    </div>

    <div class="manuscript-viewer-header">
      <div class="manuscript-title-container">
        <h2 class="manuscript-viewer-title">
          {manuscriptInfo?.title || 'Manuscript'} - Page {pageId}
        </h2>
      </div>
      <button
        on:click={() => {
          fetchData();
        }}
        class="refresh-button"
      >
        Refresh Data
      </button>
    </div>
  
    <div class="manuscript-viewer-content">
      {#if isLoading}
        <div class="loading-indicator">
          <div class = "loading-message">
            <div class="loading-title">Loading manuscript data...</div>
            <div class="loading-subtitle">This may take a moment</div>
          </div>
        </div>
      {:else if error}
        <div class="error-message">
          <div>{error}</div>
        </div>
      {:else if dataReady}
        <div class="manuscript-content-area">
          <!-- Manuscript image with segment overlays -->
          <div
            bind:this={containerRef}
            class="image-container"
            on:click={handleContainerClick}
            on:mousemove={handleMouseMove}
            on:mouseleave={() => hoveredSegment = null}
          >
            {#if image}
              <img
                bind:this={imageRef}
                src={image}
                alt="Manuscript page"
                class="manuscript-image"
                on:load={handleImageLoad}
              />
  
              {#if segmentation && segmentation.lines && imageSize.width > 0}
                {@const segBounds = segmentation.bounds || [0, 0, imageSize.width, imageSize.height]}
                {@const segWidth = segBounds[2] - segBounds[0]}
                {@const segHeight = segBounds[3] - segBounds[1]}
                {@const scaleX = imageSize.width / segWidth}
                {@const scaleY = imageSize.height / segHeight}
                {@const offsetX = -segBounds[0]}
                {@const offsetY = -segBounds[1]}
  
                <svg
                  class="segment-overlay"
                  viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                  width={imageSize.displayWidth || '100%'}
                  height={imageSize.displayHeight || '100%'}
                  preserveAspectRatio="xMidYMid meet"
                >
                  {#each segmentation.lines as line}
                    {#if line.boundary && line.boundary.length >= 3}
                      {@const isHovered = hoveredSegment === line.id}
                      {@const isSelected = selectedSegment === line.id}
                      {@const hasTranscript = transcriptMap[line.id] !== undefined}
                      {@const pathData = line.boundary.map((point, i) => {
                        // Apply coordinate transformation to each point
                        const x = (point[0] + offsetX) * scaleX;
                        const y = (point[1] + offsetY) * scaleY;
                        return `${i === 0 ? 'M' : 'L'}${x},${y}`;
                      }).join(' ') + ' Z'}
  
                      <path
                        d={pathData}
                        class="segment-path"
                        class:has-transcript={hasTranscript}
                        class:hovered={isHovered}
                        class:selected={isSelected}
                        on:mouseenter={() => hasTranscript && (hoveredSegment = line.id)}
                        on:mouseleave={() => hoveredSegment = null}
                        on:click={(e) => handleSegmentClick(e, line.id)}
                      />
                    {/if}
                  {/each}
                </svg>
              {/if}
  
              <!-- Hover tooltip -->
              {#if hoveredSegment && transcriptMap[hoveredSegment]}
                <div
                  class="segment-tooltip"
                  style="left: {Math.min(hoverPosition.x, containerRef?.clientWidth - 200 || 0)}px; top: {hoverPosition.y + 20}px;"
                  data-segment-id={hoveredSegment}
                >
                  <div class="tooltip-title">
                    {#if transcriptMap[hoveredSegment].type === 'illustration'}
                      <span class="tooltip-title-illustration">Illustration ({transcriptMap[hoveredSegment].name})</span>
                    {:else if transcriptMap[hoveredSegment].type === 'marginalia'}
                      <span class="tooltip-title-marginalia">Marginalia ({transcriptMap[hoveredSegment].name})</span>
                    {:else}
                      <span>{transcriptMap[hoveredSegment].name}</span>
                    {/if}
                  </div>
                  <div class="tooltip-content">
                    {transcriptMap[hoveredSegment].text.length > 100
                      ? `${transcriptMap[hoveredSegment].text.substring(0, 100)}...`
                      : transcriptMap[hoveredSegment].text}
                  </div>
                </div>
              {/if}
            {/if}
          </div>
  
          <!-- Transcript and translation panel -->
          <div class="transcript-panel">
            <div class="transcript-header">
              <h3 class="transcript-title">
                {showTranslation ? 'Translation' : 'Transcription'}
              </h3>
              <button
                on:click={() => showTranslation = !showTranslation}
                class="toggle-view-button"
              >
                {showTranslation ? 'Show Transcription' : 'Show Translation'}
              </button>
            </div>
  
            <!-- Content area -->
            <div bind:this={transcriptPanelRef} class="transcript-content-area">
              {#if !showTranslation}
                <!-- Transcription view -->
                {#if sortedTranscriptEntries.length > 0}
                  <div class="transcript-entries">
                    {#each sortedTranscriptEntries as entry (entry.id)}
                      {@const isHovered = hoveredSegment === entry.id}
                      {@const isSelected = selectedSegment === entry.id}
                      <div
                        bind:this={transcriptItemRefs[entry.id]}
                        class="transcript-entry"
                        class:hovered={isHovered}
                        class:selected={isSelected}
                        on:mouseenter={() => handleTranscriptMouseEnter(entry.id)}
                        on:mouseleave={handleTranscriptMouseLeave}
                        on:click={() => handleTranscriptClick(entry.id)}
                      >
                        {#if entry.type === 'illustration'}
                          <div class="transcript-entry-illustration">Illustration</div>
                        {:else if entry.type === 'marginalia'}
                          <div class="transcript-entry-marginalia">Marginalia</div>
                        {/if}
                        <div class="transcript-entry-text">
                          {entry.text}
                        </div>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <div class="no-data-message">
                    <p>No transcription data available for this page.</p>
                  </div>
                {/if}
              {:else}
                <!-- Translation view -->
                {#if transcript?.translation}
                  <div class="prose">
                    {transcript.translation}
                  </div>
                {:else}
                  <div class="no-data-message">
                    <p>No translation available for this page.</p>
                  </div>
                {/if}
              {/if}
            </div>
  
            <!-- Metadata section -->
            <div class="transcript-metadata">
              <h4 class="metadata-title">Manuscript Information</h4>
              <div class="metadata-item">
                <p><span class="metadata-label">Language:</span> {transcript?.language || 'Unknown'}</p>
                <p class = "metadata-item"><span class="metadata-label">Notes:</span> {transcript?.transcription_notes || 'No notes available'}</p>
              </div>
  
              <div class="metadata-tip">
                <p><strong class = "metadata-tip-strong">Tip:</strong> Hover over segments in the image or transcript to highlight connections.</p>
                <p>Click on a segment to select it and see the corresponding content.</p>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
  
  <style>
    /* --- Root Level Variables --- */
    :root {
      --color-primary: #8b5cf6; /* Purple */
      --color-secondary: #3b82f6; /* Blue */
      --color-accent-green: #059669;
      --color-accent-indigo: #4f46e5;
      --color-error: #ef4444;
      --color-text-primary: #1f2937;
      --color-text-secondary: #374151;
      --color-text-muted: #6b7280;
      --color-text-light: #4b5563;
      --color-background: white;
      --color-background-light: #f9fafb;
      --color-background-muted: #f3f4f6;
      --color-background-alt: #e5e7eb;
      --color-border: #e5e7eb;
      --color-link: #4a9eff;
  
      --spacing-xs: 0.25rem; /* 4px */
      --spacing-sm: 0.5rem;  /* 8px */
      --spacing-md: 1rem;   /* 16px */
      --spacing-lg: 1.5rem;  /* 24px */
      --spacing-xl: 2rem;   /* 32px */
  
      --border-radius-sm: 0.25rem;
      --border-radius-md: 0.375rem;
  
      --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
      --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    }
  
    /* --- Main Card Container --- */
    .manuscript-viewer {
      /* Combines: card, w-full, max-w-6xl, mx-auto, my-8 */
      background-color: var(--color-background);
      border-radius: var(--border-radius-md);
      box-shadow: var(--shadow-sm);
      border: 1px solid var(--color-border);
      width: 100%;          /* w-full */
      min-width: 72rem;    
      margin-left: auto;   /* mx-auto */
      margin-right: auto;  /* mx-auto */
      margin-top: 0rem;    /* my-8 */
      margin-bottom: var(--spacing-xl); /* my-8 */
    }
  
    /* Breadcrumbs */
    .breadcrumbs {
      padding: var(--spacing-md) var(--spacing-lg);
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--spacing-xs);
      background-color: var(--color-background-light);
      border-bottom: 1px solid var(--color-border);
    }

    .breadcrumb-link {
      color: var(--color-link);
      text-decoration: none;
      font-size: 0.9rem;
    }

    .breadcrumb-link:hover {
      text-decoration: underline;
    }

    .breadcrumb-separator {
      color: var(--color-text-muted);
      margin: 0 var(--spacing-xs);
    }

    .breadcrumb-current {
      color: var(--color-text-primary);
      font-weight: 500;
      font-size: 0.9rem;
    }

    .manuscript-viewer-header {
      /* Combines: card-header, flex, justify-between, items-center */
      padding: var(--spacing-md) var(--spacing-lg); /* p-4 p-6 combined */
      border-bottom: 1px solid var(--color-border);
      display: flex;         /* flex */
      justify-content: space-between; /* justify-between */
      align-items: center;    /* items-center */
    }
  
    .manuscript-title-container {
      flex: 1;
    }

    .manuscript-viewer-title {
      /* Combines: card-title */
      font-size: 1.25rem;  /* text-xl */
      font-weight: 600;   /* font-semibold */
    }
  
    .refresh-button {
          /* Combines:  px-3, py-1, text-sm, bg-gray-100, hover:bg-gray-200, rounded-md, transition-colors */
          padding-left: 0.75rem;
          padding-right: 0.75rem; /* px-3 */
          padding-top: 0.25rem;
          padding-bottom: 0.25rem; /* py-1 */
          font-size: 0.875rem; /* text-sm */
          background-color: var(--color-background-muted); /* bg-gray-100 */
          border-radius: var(--border-radius-md);
          transition-property: color, background-color, border-color;
          transition-duration: 150ms;/*transition-colors */
  
      &:hover {
        /* Combines: hover:bg-gray-200 */
        background-color: var(--color-background-alt); /* bg-gray-200 */
      }
    }
  
    .manuscript-viewer-content {
      /* Combines: card-content, p-6 */
      padding: var(--spacing-lg); /* p-6 */
      
    }
  
    /* --- Loading and Error States --- */
    .loading-indicator {
      /* Combines: p-8, flex, justify-center, items-center */
      padding: var(--spacing-xl);        /* p-8 */
      display: flex;            /* flex */
      justify-content: center;  /* justify-center */
      align-items: center;      /* items-center */
    }
    .loading-message {
      text-align: center; /* text-center */
    }
    .loading-title {
      /*Combines: text-xl mb-2*/
      font-size: 1.25rem;  /* text-xl */
      margin-bottom: 0.5rem;
    }
  
    .loading-subtitle {
      /* Combines: text-sm text-gray-500 */
      font-size: 0.875rem;              /* text-sm */
      color: var(--color-text-muted);  /* text-gray-500 */
    }
  
  
    .error-message {
      /* Combines: p-8, border-red-300 */
      padding: var(--spacing-xl);        /* p-8 */
      border-color: var(--color-error);   /*  border-red-300 NOTE: Removed the single pixel border, error is communicated with just colour */
      color: var(--color-error);   /* text-red-500 */
    }
  
    /* --- Main Content Area (Image and Transcript) --- */
    .manuscript-content-area {
      /* Combines: flex, flex-col, md:flex-row, gap-6, w-full */
      display: flex;         /* flex */
      flex-direction: column; /* flex-col */
      gap: var(--spacing-lg);   /* gap-6 */
      width: 100%;         /* w-full */
  
      @media (min-width: 768px) {
        flex-direction: row;  /* md:flex-row */
      }
    }
  
    /* --- Image Container --- */
    .image-container {
      /* Combines: relative, border, rounded-md, overflow-hidden, flex-shrink-0, style="width: fit-content; max-width: 65%;" */
      position: relative;        /* relative */
      border: 1px solid var(--color-border);     /* border */
      border-radius: var(--border-radius-md); /* rounded-md */
      overflow: hidden;           /* overflow-hidden */
      flex-shrink: 0;            /* flex-shrink-0 */
      width: fit-content;
      max-width: 65%;
    }
  
    .manuscript-image {
      /* Combines: max-w-full, h-auto */
      max-width: 100%;  /* max-w-full */
      height: auto;     /* h-auto */
    }
  
    /* --- SVG Overlay --- */
    .segment-overlay {
      /* Combines: absolute, top-0, left-0, w-full, h-full, pointer-events-none */
      position: absolute;  /* absolute */
      top: 0;             /* top-0 */
      left: 0;            /* left-0 */
      width: 100%;         /* w-full */
      height: 100%;        /* h-full */
      pointer-events: none; /* pointer-events-none */
    }
  
    .segment-path {
        pointer-events: auto;
        transition-property: all;
        transition-duration: 150ms;
        fill: transparent; /* Add this to make them invisible by default */

        &.has-transcript {
        cursor: pointer;
            &:not(.selected):not(.hovered) {
            stroke: rgba(65, 105, 225, 0.2);
            stroke-width: 1px;
            }
        }

        &.hovered {
        fill: rgba(65, 105, 225, 0.3);
        stroke: rgba(65, 105, 225, 0.8);
        stroke-width: 2px;
        }

        &.selected {
        fill: rgba(128, 0, 128, 0.3);
        stroke: rgba(128, 0, 128, 0.8);
        stroke-width: 2px;
        }
    }
  
    /* --- Tooltip --- */
    .segment-tooltip {
      /* Combines: absolute, bg-white, p-2, rounded, shadow-md, border, text-sm, max-w-xs, pointer-events-none, z-10 */
      position: absolute;                         /* absolute */
      background-color: var(--color-background);  /* bg-white */
      padding: var(--spacing-sm);                   /* p-2 */
      border-radius: var(--border-radius-sm);       /* rounded */
      box-shadow: var(--shadow-md);                 /* shadow-md */
      border: 1px solid var(--color-border);       /* border */
      min-width: 10rem;                          /* max-w-xs */
      pointer-events: none;                      /* pointer-events-none */
      z-index: 10;                                /* z-10 */
    }
  
    .tooltip-title {
      /* Combines: font-medium */
       font-weight: 500; /* font-medium */
    }
  
    .tooltip-title-illustration {
      /*Combines: tooltip-title, text-green-600*/
      font-weight: 500; /* font-medium */
      color: var(--color-accent-green); /* text-green-600 */
    }
  
      .tooltip-title-marginalia {
          /*Combines: tooltip-title, text-indigo-600 */
          font-weight: 500; /* font-medium */
          color: var(--color-accent-indigo); /* text-indigo-600 */
      }
    .tooltip-content {
      /* Combines: text-gray-700, text-xs, mt-1 */
      color: var(--color-text-secondary); /* text-gray-700 */
      margin-top: var(--spacing-xs);         /* mt-1 */
    }
  
    /* --- Transcript Panel --- */
    .transcript-panel {
      /* Combines: w-full, md:w-1/3, min-w-[300px], bg-gray-50, rounded-md, border, h-full, max-h-[600px], flex, flex-col */
      width: 100%;             /* w-full */
      min-width: 300px;       /* min-w-[300px] */
      background-color: var(--color-background-light); /* bg-gray-50 */
      border-radius: var(--border-radius-md);          /* rounded-md */
      border: 1px solid var(--color-border);          /* border */
      height: 100%;            /* h-full */
      max-height: 768px;      /* max-h-[600px] */
      display: flex;         /* flex */
      flex-direction: column; /* flex-col */
  
      @media (min-width: 768px) {
        flex-direction: column;   /* md:w-1/3 */
      }
    }
  
    .transcript-header {
      /* Combines: w-full, p-3, text-left, flex, justify-between, items-center, border-b, bg-gray-100 */
      width: 100%;         /* w-full */
      display: flex;         /* flex */
      justify-content: space-between; /* justify-between */
      align-items: normal;    /* items-center */
      border-bottom: 1px solid var(--color-border);  /* border-b */
      background-color: var(--color-background-muted); /* bg-gray-100 */
      
    }
  
    .transcript-title {
      padding-left: 0.75rem;
      font-size: 1.125rem;  /* text-lg */
      font-weight: 600;   /* font-semibold */
    }
  
    .toggle-view-button {
          padding-left: 0.75rem;
          padding-right: 0.75rem; /* px-3 */
          padding-top: 0.25rem;
          padding-bottom: 0.25rem; /* py-1 */
          font-size: 0.875rem;/*text-sm*/
          background-color: white;/*bg-white*/
          border-radius: var(--border-radius-md);
          transition-property: color, background-color, border-color;
          transition-duration: 150ms; /*transition-colors */
          border: 1px solid var(--color-border);          /* border */
  
          &:hover {
            background-color: var(--color-background-alt); /* bg-gray-200 */
      }
    }
  
    .transcript-content-area {
      /* Combines: p-4, overflow-y-auto, flex-grow */
      padding: var(--spacing-md);         /* p-4 */
      overflow-y: auto;      /* overflow-y-auto */
      flex-grow: 1;           /* flex-grow -  allows it to take up available space */
    }
  
    .transcript-entry {
        /* Combines: bg-white, p-4, rounded, shadow-sm, border-l-4, transition-all, duration-300 */
        background-color: var(--color-background); /* bg-white */
        padding: var(--spacing-md);         /* p-4 */
        border-radius: var(--border-radius-sm);      /* rounded */
        box-shadow: var(--shadow-sm);        /* shadow-sm */
        border-left: 4px solid var(--color-border);   /* border-l-4, default color */
        transition-property: all;          /* transition-all */
        transition-duration: 300ms;        /* duration-300 */
        cursor: pointer;

        /* Add margin-top to ALL .transcript-entry elements EXCEPT the first one */
        margin-top: var(--spacing-md);

        &:first-child {
            margin-top: 0; /* Remove margin-top from the first entry */
        }
        
        &.hovered {
        /* Combines: border-blue-500, bg-blue-50 */
        border-left-color: var(--color-secondary); /* border-blue-500 */
        background-color: #eff6ff;                /* bg-blue-50 */
        }

        &.selected {
        /* Combines: border-purple-500, bg-purple-50 */
        border-left-color: var(--color-primary);    /* border-purple-500 */
        background-color: #f5f3ff;              /* bg-purple-50 */
        }
    }
  
      .transcript-entry-illustration{
          /* Combines: font-medium mb-2 text-green-600 */
          font-weight: 500;/*font-medium*/
          margin-bottom: 0.5rem;/*mb-2*/
          color: var(--color-accent-green);/*text-green-600*/
      }
      .transcript-entry-marginalia{
          /* Combines: font-medium mb-2 text-indigo-600 */
          font-weight: 500;/*font-medium*/
          margin-bottom: 0.5rem;/*mb-2*/
          color: var(--color-accent-indigo);/*text-indigo-600*/
      }
  
  
    .transcript-entry-text {
      /* Combines: text-gray-800 */
      color: var(--color-text-primary);  /* text-gray-800 */
    }
  
    .no-data-message {
      /* Combines: text-gray-500, italic */
      color: var(--color-text-muted); /* text-gray-500 */
      font-style: italic;      /* italic */
    }
  
    /* --- Metadata Section --- */
    .transcript-metadata {
      /* Combines: p-4, border-t, border-gray-200, bg-gray-50 */
      padding: var(--spacing-md);                     /* p-4 */
      border-top: 1px solid var(--color-border);      /* border-t */
      background-color: var(--color-background-light); /* bg-gray-50 */
      overflow-y: auto;
      min-height: 200px;
    }
  
    .metadata-title {
      /* Combines: font-medium, text-sm, mb-2, text-gray-700 */
      font-weight: 500;                    /* font-medium */
      margin-bottom: var(--spacing-sm);      /* mb-2 */
      color: var(--color-text-secondary); /* text-gray-700 */
    }
  
    .metadata-item {
      /* Combines: text-sm, text-gray-600 */
      color: var(--color-text-light); /* text-gray-600 */
      margin-top: 0.5rem; /*mt-2*/
    }
  
    .metadata-label {
      /* Combines: font-medium */
      font-weight: 500;  /* font-medium */
    }
  
    .metadata-tip {
        /* Combines: mt-4 text-xs text-gray-500 */
        margin-top: var(--spacing-md);
        font-size: var(--spacing-s);
        color: var(--color-text-muted);/*text-gray-500*/
    }
    .metadata-tip-strong{
      font-weight: bold;
    }
  
  </style>