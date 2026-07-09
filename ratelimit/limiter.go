// Package ratelimit provides a per-IP sliding-window rate limiter and a
// dynamic blocklist with TTL. Both are per-node in-memory structures.
package ratelimit

import (
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

const (
	// DefaultMaxRequests is the number of requests allowed per window per IP.
	DefaultMaxRequests = 100
	// DefaultWindow is the duration of the sliding window.
	DefaultWindow = time.Minute
	// DefaultBlockDuration is how long a blocked IP stays on the blocklist.
	DefaultBlockDuration = 5 * time.Minute
)

// window tracks request timestamps for a single IP within the sliding window.
type window struct {
	mu         sync.Mutex
	timestamps []time.Time
}

// Limiter is a thread-safe per-IP sliding-window rate limiter combined with a
// dynamic blocklist backed by TTL expiry.
type Limiter struct {
	mu           sync.RWMutex
	windows      map[string]*window
	blocklist    map[string]time.Time // IP -> expiry time
	maxRequests  int
	windowDur    time.Duration
	blockDur     time.Duration
	totalBlocked atomic.Int64
	done         chan struct{}
	wg           sync.WaitGroup
}

// New creates a Limiter with the given parameters and starts the background
// cleanup goroutine.
func New(maxRequests int, windowDur, blockDur time.Duration) *Limiter {
	l := &Limiter{
		windows:     make(map[string]*window),
		blocklist:   make(map[string]time.Time),
		maxRequests: maxRequests,
		windowDur:   windowDur,
		blockDur:    blockDur,
		done:        make(chan struct{}),
	}
	l.wg.Add(1)
	go l.cleanupLoop()
	return l
}

// NewDefault creates a Limiter with sensible production defaults.
func NewDefault() *Limiter {
	return New(DefaultMaxRequests, DefaultWindow, DefaultBlockDuration)
}

// Allow returns true if the given IP is permitted to proceed. It automatically
// promotes IPs that exceed the rate limit onto the blocklist.
func (l *Limiter) Allow(ip string) bool {
	if l.IsBlocked(ip) {
		return false
	}

	w := l.getWindow(ip)
	w.mu.Lock()
	defer w.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-l.windowDur)

	// Evict timestamps outside the sliding window.
	j := 0
	for _, ts := range w.timestamps {
		if ts.After(cutoff) {
			w.timestamps[j] = ts
			j++
		}
	}
	w.timestamps = w.timestamps[:j]

	if len(w.timestamps) >= l.maxRequests {
		// Exceeded — auto-blocklist.
		l.Block(ip)
		return false
	}

	w.timestamps = append(w.timestamps, now)
	return true
}

// IsBlocked returns true if the IP is currently on the blocklist.
func (l *Limiter) IsBlocked(ip string) bool {
	l.mu.RLock()
	expiry, ok := l.blocklist[ip]
	l.mu.RUnlock()
	if !ok {
		return false
	}
	if time.Now().Before(expiry) {
		return true
	}
	// Expired — remove lazily.
	l.mu.Lock()
	delete(l.blocklist, ip)
	l.mu.Unlock()
	return false
}

// Block adds an IP to the blocklist for the configured block duration.
func (l *Limiter) Block(ip string) {
	l.mu.Lock()
	l.blocklist[ip] = time.Now().Add(l.blockDur)
	l.mu.Unlock()
	l.totalBlocked.Add(1)
}

// Unblock removes an IP from the blocklist.
func (l *Limiter) Unblock(ip string) {
	l.mu.Lock()
	delete(l.blocklist, ip)
	l.mu.Unlock()
}

// Stats returns current limiter metrics.
func (l *Limiter) Stats() (activeLimits, blocklistEntries int) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	now := time.Now()
	for _, expiry := range l.blocklist {
		if now.Before(expiry) {
			blocklistEntries++
		}
	}
	activeLimits = len(l.windows)
	return
}

// TotalBlocked returns the cumulative number of IPs auto-blocked.
func (l *Limiter) TotalBlocked() int64 { return l.totalBlocked.Load() }

// Middleware returns an http.Handler that enforces rate limiting. Blocked
// requests receive 429 Too Many Requests.
func (l *Limiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := extractIP(r)
		if !l.Allow(ip) {
			http.Error(w, `{"status":"FAILED","error":"Rate limit exceeded"}`, http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Close stops the background cleanup goroutine.
func (l *Limiter) Close() {
	close(l.done)
	l.wg.Wait()
}

// getWindow returns (or creates) the sliding-window tracker for an IP.
func (l *Limiter) getWindow(ip string) *window {
	l.mu.RLock()
	w, ok := l.windows[ip]
	l.mu.RUnlock()
	if ok {
		return w
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	// Double-check after acquiring write lock.
	if w, ok = l.windows[ip]; ok {
		return w
	}
	w = &window{}
	l.windows[ip] = w
	return w
}

// cleanupLoop periodically removes expired entries to bound memory growth.
func (l *Limiter) cleanupLoop() {
	defer l.wg.Done()
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			l.cleanup()
		case <-l.done:
			return
		}
	}
}

func (l *Limiter) cleanup() {
	now := time.Now()
	cutoff := now.Add(-l.windowDur)

	l.mu.Lock()
	defer l.mu.Unlock()

	// Remove expired blocklist entries.
	for ip, expiry := range l.blocklist {
		if now.After(expiry) {
			delete(l.blocklist, ip)
		}
	}

	// Remove stale windows (no recent requests).
	for ip, w := range l.windows {
		w.mu.Lock()
		j := 0
		for _, ts := range w.timestamps {
			if ts.After(cutoff) {
				w.timestamps[j] = ts
				j++
			}
		}
		w.timestamps = w.timestamps[:j]
		empty := len(w.timestamps) == 0
		w.mu.Unlock()
		if empty {
			delete(l.windows, ip)
		}
	}
}

// extractIP reads the real client IP from X-Forwarded-For (set by Fly.io) or
// falls back to RemoteAddr.
func extractIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return xff
	}
	ip := r.RemoteAddr
	// Strip port if present.
	for i := len(ip) - 1; i >= 0; i-- {
		if ip[i] == ':' {
			return ip[:i]
		}
	}
	return ip
}
