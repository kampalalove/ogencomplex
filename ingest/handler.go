package ingest

import (
    "encoding/json"
    "fmt"
    "net/http"
    "time"

    "github.com/kampalalove/ogencomplex/audit"
    "github.com/kampalalove/ogencomplex/cache"
    "github.com/kampalalove/ogencomplex/index"
    "github.com/kampalalove/ogencomplex/models"
    "github.com/kampalalove/ogencomplex/rules"
    "github.com/kampalalove/ogencomplex/state"
)

type Handler struct {
    IndexWriter  *index.Writer
    RulesManager *rules.Manager
    StateManager *state.DistributedState
    AuditLogger  *audit.AsyncLogger
    Cache        *cache.WriteThroughCache
}

func NewHandler(
    basePath string,
    rm *rules.Manager,
    sm *state.DistributedState,
    al *audit.AsyncLogger,
    c *cache.WriteThroughCache,
) (*Handler, error) {
    writer := index.NewWriter(basePath)
    return &Handler{
        IndexWriter:  writer,
        RulesManager: rm,
        StateManager: sm,
        AuditLogger:  al,
        Cache:        c,
    }, nil
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    start := time.Now()

    // Handle GET requests for system status
    if r.Method == http.MethodGet {
        systemID := r.URL.Query().Get("system_id")
        w.Header().Set("Content-Type", "application/json")
        
        if systemID == "" {
            response := map[string]interface{}{
                "status":      "ONLINE",
                "cluster":     "universe.index",
                "timestamp":   time.Now().UTC().Format(time.RFC3339),
                "sovereign":   true,
                "environment": "edge-lax",
            }
            w.WriteHeader(http.StatusOK)
            json.NewEncoder(w).Encode(response)
            return
        }
        
        // Try cache first
        if cached, ok := h.Cache.Get(systemID); ok {
            w.WriteHeader(http.StatusOK)
            json.NewEncoder(w).Encode(cached)
            return
        }
        
        // Fallback to disk
        profile, exists, err := h.IndexWriter.LoadOrCreate(systemID)
        if err != nil {
            h.sendError(w, 500, fmt.Sprintf("Failed to load profile: %s", err.Error()))
            return
        }
        if !exists {
            h.sendError(w, 404, fmt.Sprintf("System not found: %s", systemID))
            return
        }
        
        // Cache for future requests
        h.Cache.Put(systemID, profile)
        
        w.WriteHeader(http.StatusOK)
        json.NewEncoder(w).Encode(profile)
        return
    }

    if r.Method != http.MethodPost {
        http.Error(w, `{"status":"FAILED","error":"Method not allowed"}`, http.StatusMethodNotAllowed)
        return
    }

    var payload models.IngestPayload
    if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
        h.sendError(w, 400, fmt.Sprintf("Invalid JSON payload: %s", err.Error()))
        return
    }

    if payload.SystemID == "" || payload.ContextSummary == "" {
        h.sendError(w, 400, "Missing required keys: 'system_id' and 'context_summary' are mandatory")
        return
    }

    if payload.Platform == "" {
        payload.Platform = "Gemini"
    }

    // Dynamic Gate: Evaluate against rules
    allowed, ruleID := h.RulesManager.Evaluate(payload)
    if !allowed {
        h.sendError(w, 403, fmt.Sprintf("Dynamic Rule Engine blocked request. Rule ID: %s (DENY)", ruleID))
        return
    }

    fragment := models.AIFragment{
        Platform:          payload.Platform,
        ContextSummary:    payload.ContextSummary,
        LastSyncTimestamp: time.Now().UTC().Format(time.RFC3339),
    }

    if payload.URL != "" {
        fragment.URL = &payload.URL
    }
    if payload.ThreadID != "" {
        fragment.ThreadID = &payload.ThreadID
    }

    if err := h.IndexWriter.AppendFragment(payload.SystemID, fragment); err != nil {
        h.sendError(w, 500, fmt.Sprintf("Failed to write index: %s", err.Error()))
        return
    }

    if payload.ResolvedLoops > 0 {
        if err := h.IndexWriter.UpdateLoops(payload.SystemID, payload.ResolvedLoops); err != nil {
            fmt.Printf("Warning: failed to update loops: %s\n", err.Error())
        }
    }

    // Log audit event asynchronously
    h.AuditLogger.Log(audit.AuditEvent{
        Timestamp:  time.Now(),
        IP:         r.RemoteAddr,
        Method:     r.Method,
        Path:       r.URL.Path,
        SystemID:   payload.SystemID,
        StatusCode: http.StatusOK,
        LatencyMs:  time.Since(start).Milliseconds(),
        RuleID:     ruleID,
        Allowed:    true,
    })

    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(map[string]interface{}{
        "status":  "SUCCESS",
        "message": fmt.Sprintf("Anchored thread fragment into %s verified against rule: %s", payload.SystemID, ruleID),
    })
}

func (h *Handler) sendError(w http.ResponseWriter, code int, message string) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(code)
    json.NewEncoder(w).Encode(map[string]interface{}{
        "status": "FAILED",
        "error":  message,
    })
}