// Package health exposes a GET /health endpoint reporting node identity,
// region, uptime, and sovereign status.
package health

import (
	"encoding/json"
	"net/http"
	"os"
	"time"
)

// Handler serves GET /health.
type Handler struct {
	nodeID    string
	region    string
	startTime time.Time
}

// New creates a Handler stamped with the given node ID and region.
func New(nodeID, region string) *Handler {
	return &Handler{
		nodeID:    nodeID,
		region:    region,
		startTime: time.Now(),
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"status":"FAILED","error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	uptime := time.Since(h.startTime).Round(time.Second).String()
	hostname, _ := os.Hostname()
	resp := map[string]interface{}{
		"status":    "ONLINE",
		"cluster":   "universe.index",
		"node_id":   h.nodeID,
		"region":    h.region,
		"hostname":  hostname,
		"uptime":    uptime,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"sovereign": true,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
