package query

import (
"fmt"
"net/http"
"os"
"path/filepath"
)

type Handler struct {
BasePath string
}

func NewHandler(basePath string) *Handler {
return &Handler{BasePath: basePath}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
if r.Method != http.MethodGet {
w.Header().Set("Content-Type", "application/json")
w.WriteHeader(http.StatusMethodNotAllowed)
w.Write([]byte(`{"status":"FAILED","error":"Method not allowed"}`))
return
}

systemID := r.URL.Query().Get("system_id")
if systemID == "" {
w.Header().Set("Content-Type", "application/json")
w.WriteHeader(http.StatusBadRequest)
w.Write([]byte(`{"status":"FAILED","error":"Missing required query parameter: 'system_id'"}`))
return
}

// Route down to the underlying universe directory database tracking index
profilePath := filepath.Join(h.BasePath, "universe.index", fmt.Sprintf("%s.json", systemID))
data, err := os.ReadFile(profilePath)
if err != nil {
w.Header().Set("Content-Type", "application/json")
if os.IsNotExist(err) {
w.WriteHeader(http.StatusNotFound)
w.Write([]byte(fmt.Sprintf(`{"status":"FAILED","error":"System profile not found for target: %s"}`, systemID)))
} else {
w.WriteHeader(http.StatusInternalServerError)
w.Write([]byte(fmt.Sprintf(`{"status":"FAILED","error":"Failed to read snapshot state: %s"}`, err.Error())))
}
return
}

w.Header().Set("Content-Type", "application/json")
w.WriteHeader(http.StatusOK)
w.Write(data)
}