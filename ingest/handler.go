package ingest

import (
"encoding/json"
"fmt"
"net/http"
"os"
"path/filepath"
"time"

"github.com/kampalalove/ogencomplex/index"
"github.com/kampalalove/ogencomplex/models"
"github.com/kampalalove/ogencomplex/policy"
)

type Handler struct {
IndexWriter    *index.Writer
PolicyEnforcer *policy.Enforcer
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

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
// --- DEEP READ TRACK: Dynamic State Telemetry Extraction ---
if r.Method == http.MethodGet {
systemID := r.URL.Query().Get("system_id")
w.Header().Set("Content-Type", "application/json")

if systemID == "" {
// Fallback to standard core cluster health signature
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

// Read the stored telemetry fragment directly from disk
basePath, _ := os.Getwd()
profilePath := filepath.Join(basePath, "universe.index", fmt.Sprintf("%s.json", systemID))

data, err := os.ReadFile(profilePath)
if err != nil {
if os.IsNotExist(err) {
w.WriteHeader(http.StatusNotFound)
w.Write([]byte(fmt.Sprintf(`{"status":"FAILED","error":"System profile not found for target: %s"}`, systemID)))
} else {
w.WriteHeader(http.StatusInternalServerError)
w.Write([]byte(fmt.Sprintf(`{"status":"FAILED","error":"Internal server error: %s"}`, err.Error())))
}
return
}

w.WriteHeader(http.StatusOK)
w.Write(data)
return
}

// --- INGESTION POST ROUTE ---
if r.Method != http.MethodPost {
http.Error(w, `{"status":"FAILED","error":"Method not allowed"}`, http.StatusMethodNotAllowed)
return
}

var payload models.IngestPayload
if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
h.sendError(w, 400, fmt.Sprintf("Invalid JSON payload: %s", err.Error()))
return
}

if payload.SystemID == "" {
h.sendError(w, 400, "Missing required key: 'system_id' is mandatory")
return
}
if payload.ContextSummary == "" {
h.sendError(w, 400, "Missing required key: 'context_summary' is mandatory")
return
}

if payload.Platform == "" {
payload.Platform = "Gemini"
}

allowed, ruleID := h.PolicyEnforcer.Evaluate(payload)
if !allowed {
h.sendError(w, 403, fmt.Sprintf("Policy rail blocked: %s (DENY)", ruleID))
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
h.sendError(w, 500, fmt.Sprintf("Failed to write index: %s", err.Error()))
return
}

if payload.ResolvedLoops > 0 {
if err := h.IndexWriter.UpdateLoops(payload.SystemID, payload.ResolvedLoops); err != nil {
fmt.Printf("Warning: failed to update loops: %s\n", err.Error())
}
}

w.Header().Set("Content-Type", "application/json")
w.WriteHeader(http.StatusOK)
response := map[string]interface{}{
"status":  "SUCCESS",
"message": fmt.Sprintf("Anchored thread fragment into %s cleanly.", payload.SystemID),
}
json.NewEncoder(w).Encode(response)

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
}// Build Token: 20260709035146
