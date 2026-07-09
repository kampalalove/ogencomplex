// Package metrics exposes a GET /metrics endpoint reporting cache performance,
// rate-limiter status, audit-logger stats, and aggregate request counters.
package metrics

import (
	"encoding/json"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/kampalalove/ogencomplex/audit"
	"github.com/kampalalove/ogencomplex/cache"
	"github.com/kampalalove/ogencomplex/ratelimit"
)

// Collector aggregates metrics from the various subsystems and tracks overall
// request counters. It is safe for concurrent use.
type Collector struct {
	Cache   *cache.Cache
	Limiter *ratelimit.Limiter
	Audit   *audit.Logger

	nodeID    string
	region    string
	startTime time.Time

	totalRequests atomic.Int64
	totalErrors   atomic.Int64
}

// New creates a Collector bound to the given subsystem references.
func New(c *cache.Cache, l *ratelimit.Limiter, a *audit.Logger, nodeID, region string) *Collector {
	return &Collector{
		Cache:     c,
		Limiter:   l,
		Audit:     a,
		nodeID:    nodeID,
		region:    region,
		startTime: time.Now(),
	}
}

// RecordRequest increments the total request counter.
func (col *Collector) RecordRequest() { col.totalRequests.Add(1) }

// RecordError increments the total error counter.
func (col *Collector) RecordError() { col.totalErrors.Add(1) }

// Handler serves GET /metrics.
type Handler struct {
	collector *Collector
}

// NewHandler creates an http.Handler backed by the given Collector.
func NewHandler(col *Collector) *Handler {
	return &Handler{collector: col}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"status":"FAILED","error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	col := h.collector
	uptime := time.Since(col.startTime).Round(time.Second).String()

	cacheHits, cacheMisses, dirtyEntries := col.Cache.Stats()
	hitRatio := col.Cache.HitRatio()
	activeLimits, blocklistEntries := col.Limiter.Stats()

	totalReq := col.totalRequests.Load()
	totalErr := col.totalErrors.Load()
	var errorRate float64
	if totalReq > 0 {
		errorRate = float64(totalErr) / float64(totalReq)
	}

	resp := map[string]interface{}{
		"node_identity": map[string]interface{}{
			"node_id": col.nodeID,
			"region":  col.region,
			"uptime":  uptime,
		},
		"cache": map[string]interface{}{
			"hit_count":     cacheHits,
			"miss_count":    cacheMisses,
			"hit_ratio":     hitRatio,
			"dirty_entries": dirtyEntries,
		},
		"rate_limiting": map[string]interface{}{
			"active_limits":     activeLimits,
			"blocklist_entries": blocklistEntries,
			"total_blocked":     col.Limiter.TotalBlocked(),
			"peers":             0, // per-node; no distributed coordination
		},
		"audit": map[string]interface{}{
			"events_written": col.Audit.Written(),
			"events_dropped": col.Audit.Dropped(),
		},
		"requests": map[string]interface{}{
			"total_requests": totalReq,
			"total_errors":   totalErr,
			"error_rate":     errorRate,
		},
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
