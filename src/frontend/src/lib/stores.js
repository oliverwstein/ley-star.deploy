import { writable } from 'svelte/store';

// Store for manuscript list
export const manuscriptsStore = writable({
    manuscripts: [],
    loading: false,
    error: null,
    loaded: false
});

// Function to load manuscripts data
export async function loadManuscripts() {
    const store = manuscriptsStore;
    
    // Return immediately if data is already loaded
    store.update(state => {
        if (!state.loaded && !state.loading) {
            return { ...state, loading: true };
        }
        return state;
    });
    
    // Get current state
    let currentState;
    const unsubscribe = store.subscribe(state => {
        currentState = state;
    });
    unsubscribe();
    
    // If already loaded or loading, return
    if (currentState.loaded || (currentState.loading && currentState.loading !== true)) {
        return;
    }
    
    try {
        const response = await fetch('/api/manuscripts');
        if (!response.ok) {
            throw new Error('Failed to fetch manuscripts');
        }
        const data = await response.json();
        
        store.update(state => ({
            ...state,
            manuscripts: data.manuscripts || [],
            loading: false,
            error: null,
            loaded: true
        }));
    } catch (error) {
        console.error('Error fetching manuscripts:', error);
        store.update(state => ({
            ...state,
            loading: false,
            error: error.message,
            loaded: false
        }));
    }
}