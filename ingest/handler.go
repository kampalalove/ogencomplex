package ingest

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kampalalove/ogencomplex/audit"
	"github.com/kampalalove/ogencomplex/cache"
	"github.com/kampalalove/ogencomplex/index"
	"github.com/kampalalove/ogencomplex/models"
	"github.com/kampalalove/ogencomplex/policy"
)

// Handler processes ingest and query requests. Cache and AuditLogger are
// optional; when nil the handler falls back to direct disk I/O and no logging.
type Handler struct {
	IndexWriter    *index.Writer
	PolicyEnforcer *policy.Enforcer
	Cache          *cache.Cache
	AuditLogger    *audit.Logger
}

func NewHandler(basePath string) (*Handler, error) {
	writer := index.NewWriter(basePath)
	enforcer, err := policy.NewEnforcer(basePath)
	if err != nil {
		return nil, err
	}
	return &Handler{
		IndexWriter:    writer,
		PolicyEnforcer: enforcer,
	}, nil
}

// validateSystemID rejects values that could cause path traversal or that
// contain characters invalid for a JSON file name component. It also blocks
// URL-encoded sequences that could normalise to dangerous paths.
func validateSystemID(id string) error {
	if id == "" {
		return fmt.Errorf("system_id is empty")
	}
	if strings.Contains(id, "..") || strings.ContainsAny(id, "/\\<>\x00") {
		return fmt.Errorf("system_id contains invalid characters")
	}
	// Block URL-encoded sequences that could decode to traversal characters.
	lower := strings.ToLower(id)
	if strings.Contains(lower, "%2e") || strings.Contains(lower, "%2f") ||
		strings.Contains(lower, "%5c") || strings.Contains(lower, "%00") {
		return fmt.Errorf("system_id contains invalid characters")
	}
	return nil
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

	// --- DEEP READ TRACK: Dynamic State Telemetry Extraction ---
	if r.Method == http.MethodGet {
		systemID := r.URL.Query().Get("system_id")
		rw.Header().Set("Content-Type", "application/json")

		if systemID == "" {
			// Cluster health signature.
			response := map[string]interface{}{
				"status":      "ONLINE",
				"cluster":     "universe.index",
				"timestamp":   time.Now().UTC().Format(time.RFC3339),
				"sovereign":   true,
				"environment": "edge-lax",
			}
			rw.WriteHeader(http.StatusOK)
			json.NewEncoder(rw).Encode(response)
			h.emitAudit(r, rw.statusCode, time.Since(start), "", "", true)
			return
		}

		if err := validateSystemID(systemID); err != nil {
			h.sendError(rw, http.StatusBadRequest, err.Error())
			h.emitAudit(r, rw.statusCode, time.Since(start), systemID, "", false)
			return
		}

		// Try cache first; fall back to disk.
		if h.Cache != nil {
			if profile, ok := h.Cache.Get(systemID); ok {
				rw.WriteHeader(http.StatusOK)
				json.NewEncoder(rw).Encode(profile)
				h.emitAudit(r, rw.statusCode, time.Since(start), systemID, "", true)
				return
			}
		}

		// Cache miss — read from disk.
		basePath, _ := os.Getwd()
		profilePath := filepath.Join(basePath, "universe.index", fmt.Sprintf("%s.json", systemID))
		data, err := os.ReadFile(profilePath)
		if err != nil {
			if os.IsNotExist(err) {
				h.sendError(rw, http.StatusNotFound, "System profile not found for target: "+systemID)
			} else {
				h.sendError(rw, http.StatusInternalServerError, "Internal read error")
			}
			h.emitAudit(r, rw.statusCode, time.Since(start), systemID, "", false)
			return
		}

		rw.WriteHeader(http.StatusOK)
		rw.Write(data)
		h.emitAudit(r, rw.statusCode, time.Since(start), systemID, "", true)
		return
	}

	// --- INGESTION POST ROUTE ---
	if r.Method != http.MethodPost {
		http.Error(rw, `{"status":"FAILED","error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		h.emitAudit(r, rw.statusCode, time.Since(start), "", "", false)
		return
	}

	var payload models.IngestPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		h.sendError(rw, 400, fmt.Sprintf("Invalid JSON payload: %s", err.Error()))
		h.emitAudit(r, rw.statusCode, time.Since(start), "", "", false)
		return
	}

	if payload.SystemID == "" {
		h.sendError(rw, 400, "Missing required key: 'system_id' is mandatory")
		h.emitAudit(r, rw.statusCode, time.Since(start), "", "", false)
		return
	}
	if payload.ContextSummary == "" {
		h.sendError(rw, 400, "Missing required key: 'context_summary' is mandatory")
		h.emitAudit(r, rw.statusCode, time.Since(start), payload.SystemID, "", false)
		return
	}
	if err := validateSystemID(payload.SystemID); err != nil {
		h.sendError(rw, 400, err.Error())
		h.emitAudit(r, rw.statusCode, time.Since(start), payload.SystemID, "", false)
		return
	}

	if payload.Platform == "" {
		payload.Platform = "Gemini"
	}

	allowed, ruleID := h.PolicyEnforcer.Evaluate(payload)
	if !allowed {
		h.sendError(rw, 403, fmt.Sprintf("Policy rail blocked: %s (DENY)", ruleID))
		h.emitAudit(r, rw.statusCode, time.Since(start), payload.SystemID, ruleID, false)
		return
	}

	fragment := models.AIFragment{
		Platform:          payload.Platform,
		URL:               nil,
		ThreadID:          nil,
		ContextSummary:    payload.ContextSummary,
		LastSyncTimestamp: time.Now().UTC().Format(time.RFC3339),
		Sha256OfExport:    nil,
	}
	if payload.URL != "" {
		fragment.URL = &payload.URL
	}
	if payload.ThreadID != "" {
		fragment.ThreadID = &payload.ThreadID
	}

	if err := h.IndexWriter.AppendFragment(payload.SystemID, fragment); err != nil {
		h.sendError(rw, 500, fmt.Sprintf("Failed to write index: %s", err.Error()))
		h.emitAudit(r, rw.statusCode, time.Since(start), payload.SystemID, ruleID, false)
		return
	}

	// Invalidate the cache entry so the next read sees fresh data.
	if h.Cache != nil {
		if profile, _, err := h.IndexWriter.LoadOrCreate(payload.SystemID); err == nil {
			h.Cache.Put(profile)
		}
	}

	if payload.ResolvedLoops > 0 {
		if err := h.IndexWriter.UpdateLoops(payload.SystemID, payload.ResolvedLoops); err != nil {
			fmt.Printf("Warning: failed to update loops: %s\n", err.Error())
		}
	}

	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(http.StatusOK)
	response := map[string]interface{}{
		"status":  "SUCCESS",
		"message": fmt.Sprintf("Anchored thread fragment into %s cleanly.", payload.SystemID),
	}
	json.NewEncoder(rw).Encode(response)
	h.emitAudit(r, rw.statusCode, time.Since(start), payload.SystemID, ruleID, true)
	fmt.Printf("[Webhook Core] Successfully synchronized live fragment for target: %s\n", payload.SystemID)
}

func (h *Handler) sendError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	response := map[string]interface{}{
		"status": "FAILED",
		"error":  message,
	}
	json.NewEncoder(w).Encode(response)
}

// emitAudit sends a non-blocking audit event if a logger is configured.
func (h *Handler) emitAudit(r *http.Request, status int, latency time.Duration, systemID, ruleID string, allowed bool) {
	if h.AuditLogger == nil {
		return
	}
	h.AuditLogger.Emit(audit.Event{
		IP:         extractIP(r),
		Method:     r.Method,
		Path:       r.URL.Path,
		SystemID:   systemID,
		StatusCode: status,
		LatencyMs:  latency.Milliseconds(),
		RuleID:     ruleID,
		Allowed:    allowed,
	})
}

// extractIP reads the real client IP from X-Forwarded-For or RemoteAddr.
// X-Forwarded-For may be a comma-separated list (client, proxy1, proxy2);
// only the leftmost value (the real client IP) is used.
func extractIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if idx := strings.IndexByte(xff, ','); idx != -1 {
			return strings.TrimSpace(xff[:idx])
		}
		return strings.TrimSpace(xff)
	}
	ip := r.RemoteAddr
	for i := len(ip) - 1; i >= 0; i-- {
		if ip[i] == ':' {
			return ip[:i]
		}
	}
	return ip
}

// responseWriter wraps http.ResponseWriter to capture the status code for audit
// logging and metrics. All write paths in ServeHTTP call WriteHeader explicitly
// so we do not need to override Write.
type responseWriter struct {
	http.ResponseWriter
	statusCode int
	written    bool
}

func (rw *responseWriter) WriteHeader(code int) {
	if !rw.written {
		rw.statusCode = code
		rw.written = true
		rw.ResponseWriter.WriteHeader(code)
	}
}// Build Token: 20260709035146
