package cache

import (
    "encoding/json"
    "os"
    "path/filepath"
    "sync"
    "time"
)

type CachedEntry struct {
    Profile    interface{}
    LastAccess time.Time
    Dirty      bool
}

type WriteThroughCache struct {
    mu           sync.RWMutex
    cache        map[string]*CachedEntry
    basePath     string
    flushTicker  *time.Ticker
    stopChan     chan struct{}
    wg           sync.WaitGroup
}

func NewWriteThroughCache(basePath string) *WriteThroughCache {
    wtc := &WriteThroughCache{
        cache:       make(map[string]*CachedEntry),
        basePath:    basePath,
        flushTicker: time.NewTicker(10 * time.Second),
        stopChan:    make(chan struct{}),
    }
    wtc.wg.Add(1)
    go wtc.flusher()
    return wtc
}

func (wtc *WriteThroughCache) Get(key string) (interface{}, bool) {
    wtc.mu.RLock()
    if entry, exists := wtc.cache[key]; exists {
        entry.LastAccess = time.Now()
        wtc.mu.RUnlock()
        return entry.Profile, true
    }
    wtc.mu.RUnlock()
    return nil, false
}

func (wtc *WriteThroughCache) Put(key string, value interface{}) {
    wtc.mu.Lock()
    defer wtc.mu.Unlock()
    wtc.cache[key] = &CachedEntry{
        Profile:    value,
        LastAccess: time.Now(),
        Dirty:      true,
    }
}

func (wtc *WriteThroughCache) flusher() {
    defer wtc.wg.Done()
    for {
        select {
        case <-wtc.flushTicker.C:
            wtc.flush()
        case <-wtc.stopChan:
            wtc.flush()
            return
        }
    }
}

func (wtc *WriteThroughCache) flush() {
    wtc.mu.RLock()
    toFlush := make(map[string]interface{})
    for id, entry := range wtc.cache {
        if entry.Dirty {
            toFlush[id] = entry.Profile
        }
    }
    wtc.mu.RUnlock()
    
    if len(toFlush) == 0 {
        return
    }
    
    indexDir := filepath.Join(wtc.basePath, "universe.index")
    os.MkdirAll(indexDir, 0755)
    
    for id, value := range toFlush {
        data, _ := json.MarshalIndent(value, "", "  ")
        path := filepath.Join(indexDir, id+".json")
        os.WriteFile(path, data, 0644)
        
        wtc.mu.Lock()
        if entry, exists := wtc.cache[id]; exists {
            entry.Dirty = false
        }
        wtc.mu.Unlock()
    }
}

func (wtc *WriteThroughCache) Close() {
    close(wtc.stopChan)
    wtc.wg.Wait()
    wtc.flushTicker.Stop()
}

func (wtc *WriteThroughCache) Stats() map[string]interface{} {
    wtc.mu.RLock()
    defer wtc.mu.RUnlock()
    dirty := 0
    for _, entry := range wtc.cache {
        if entry.Dirty {
            dirty++
        }
    }
    return map[string]interface{}{
        "entries": len(wtc.cache),
        "dirty":   dirty,
    }
}