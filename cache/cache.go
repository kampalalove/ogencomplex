// Package cache provides a write-through in-memory cache for SystemProfile
// records. Dirty entries are flushed to disk asynchronously every 10 seconds,
// reducing write amplification while keeping reads instantaneous.
package cache

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/kampalalove/ogencomplex/models"
)

const (
	indexDir      = "universe.index"
	flushInterval = 10 * time.Second
)

// entry holds a cached SystemProfile with a dirty flag.
type entry struct {
	profile *models.SystemProfile
	dirty   bool
}

// Cache is a write-through in-memory cache backed by JSON files on disk.
type Cache struct {
	mu       sync.RWMutex
	entries  map[string]*entry
	basePath string
	done     chan struct{}
	wg       sync.WaitGroup
	hits     atomic.Int64
	misses   atomic.Int64
}

// New creates a Cache and starts the background flush goroutine.
func New(basePath string) *Cache {
	c := &Cache{
		entries:  make(map[string]*entry),
		basePath: basePath,
		done:     make(chan struct{}),
	}
	c.wg.Add(1)
	go c.flushLoop()
	return c
}

// Get returns the cached profile for systemID, loading from disk on cache miss.
func (c *Cache) Get(systemID string) (*models.SystemProfile, bool) {
	c.mu.RLock()
	if e, ok := c.entries[systemID]; ok {
		c.mu.RUnlock()
		c.hits.Add(1)
		return e.profile, true
	}
	c.mu.RUnlock()

	// Cache miss — try to load from disk.
	c.misses.Add(1)
	profile, err := c.loadFromDisk(systemID)
	if err != nil {
		return nil, false
	}
	c.mu.Lock()
	c.entries[systemID] = &entry{profile: profile, dirty: false}
	c.mu.Unlock()
	return profile, true
}

// Put writes a profile into the cache and marks it dirty for deferred flush.
func (c *Cache) Put(profile *models.SystemProfile) {
	c.mu.Lock()
	c.entries[profile.SystemID] = &entry{profile: profile, dirty: true}
	c.mu.Unlock()
}

// Stats returns cache performance metrics.
func (c *Cache) Stats() (hits, misses, dirty int64) {
	hits = c.hits.Load()
	misses = c.misses.Load()
	c.mu.RLock()
	for _, e := range c.entries {
		if e.dirty {
			dirty++
		}
	}
	c.mu.RUnlock()
	return
}

// HitRatio returns the cache hit ratio as a float in [0, 1].
func (c *Cache) HitRatio() float64 {
	h := c.hits.Load()
	m := c.misses.Load()
	total := h + m
	if total == 0 {
		return 0
	}
	return float64(h) / float64(total)
}

// Close flushes all dirty entries and stops the background goroutine.
func (c *Cache) Close() {
	close(c.done)
	c.wg.Wait()
	c.flushDirty()
}

// flushLoop periodically flushes dirty entries to disk.
func (c *Cache) flushLoop() {
	defer c.wg.Done()
	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			c.flushDirty()
		case <-c.done:
			return
		}
	}
}

// flushDirty writes all dirty cache entries to disk.
func (c *Cache) flushDirty() {
	c.mu.Lock()
	// Collect dirty entries while holding the lock.
	type snapshot struct {
		id      string
		profile *models.SystemProfile
	}
	var dirty []snapshot
	for id, e := range c.entries {
		if e.dirty {
			dirty = append(dirty, snapshot{id: id, profile: e.profile})
			e.dirty = false
		}
	}
	c.mu.Unlock()

	for _, s := range dirty {
		if err := c.writeToDisk(s.profile); err != nil {
			fmt.Fprintf(os.Stderr, "[cache] flush error for %s: %v\n", s.id, err)
			// Re-mark dirty on failure so it will be retried next cycle.
			c.mu.Lock()
			if e, ok := c.entries[s.id]; ok {
				e.dirty = true
			}
			c.mu.Unlock()
		}
	}
}

func (c *Cache) loadFromDisk(systemID string) (*models.SystemProfile, error) {
	path := filepath.Join(c.basePath, indexDir, fmt.Sprintf("%s.json", systemID))
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var p models.SystemProfile
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (c *Cache) writeToDisk(profile *models.SystemProfile) error {
	dir := filepath.Join(c.basePath, indexDir)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	path := filepath.Join(dir, fmt.Sprintf("%s.json", profile.SystemID))
	data, err := json.MarshalIndent(profile, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
