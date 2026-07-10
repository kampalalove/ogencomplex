package ingest

import (
"encoding/json"
"fmt"
"net/http"
"os"
"path/filepath"
"time"

"github.com/kampalalove/ogencomplex/models"
"github.com/kampalalove/ogencomplex/index"
"github.com/kampalalove/ogencomplex/rules"
)

type Handler struct {
IndexWriter  *index.Writer
RulesManager *rules.Manager
}

func NewHandler(basePath string, rm *rules.Manager) (*Handler, error) {
writer := index.NewWriter(basePath)
return &Handler{
IndexWriter:  writer,
RulesManager: rm,
}, nil
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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

// Dynamic Gate: Screen payload parameters directly against hot memory
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