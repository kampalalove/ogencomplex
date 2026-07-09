package rules

import (
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
    "path/filepath"
    "sync"

    "github.com/kampalalove/ogencomplex/models"
)

type Manager struct {
    mu         sync.RWMutex
    PolicyPath string
    Policy     *models.PolicyRail
}

func NewManager(basePath string) *Manager {
    policyPath := filepath.Join(basePath, "policy_rail_v1.json")
    m := &Manager{
        PolicyPath: policyPath,
    }
    m.loadPolicy()
    return m
}

func (m *Manager) loadPolicy() {
    m.mu.Lock()
    defer m.mu.Unlock()

    data, err := os.ReadFile(m.PolicyPath)
    if err != nil {
        // Default policy if file doesn't exist
        m.Policy = &models.PolicyRail{
            PolicyID: "default-allow-v1",
            Version:  "1.0.0",
            Rules: []models.Rule{
                {ID: "allow-all", Condition: "true", Effect: "ALLOW"},
            },
        }
        return
    }

    var policy models.PolicyRail
    if err := json.Unmarshal(data, &policy); err == nil {
        m.Policy = &policy
    }
}

func (m *Manager) GetPolicy() *models.PolicyRail {
    m.mu.RLock()
    defer m.mu.RUnlock()
    return m.Policy
}

func (m *Manager) UpdatePolicy(policy *models.PolicyRail) error {
    m.mu.Lock()
    defer m.mu.Unlock()

    data, err := json.MarshalIndent(policy, "", "  ")
    if err != nil {
        return err
    }

    if err := os.WriteFile(m.PolicyPath, data, 0644); err != nil {
        return err
    }

    m.Policy = policy
    return nil
}

func (m *Manager) Evaluate(payload models.IngestPayload) (bool, string) {
    policy := m.GetPolicy()
    if policy == nil {
        return false, "No policy loaded"
    }

    for _, rule := range policy.Rules {
        if rule.Condition == "true" {
            if rule.Effect == "DENY" {
                return false, rule.ID
            }
            if rule.Effect == "ALLOW" {
                return true, rule.ID
            }
        }
    }
    return false, "fail_closed_default"
}

// HTTP Handler
type Handler struct {
    Manager *Manager
}

func NewHandler(basePath string) *Handler {
    return &Handler{
        Manager: NewManager(basePath),
    }
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case http.MethodGet:
        h.listRules(w, r)
    case http.MethodPost:
        h.updateRules(w, r)
    default:
        http.Error(w, `{"status":"FAILED","error":"Method not allowed"}`, http.StatusMethodNotAllowed)
    }
}

func (h *Handler) listRules(w http.ResponseWriter, r *http.Request) {
    policy := h.Manager.GetPolicy()
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]interface{}{
        "status": "SUCCESS",
        "policy": policy,
    })
}

func (h *Handler) updateRules(w http.ResponseWriter, r *http.Request) {
    body, err := io.ReadAll(r.Body)
    if err != nil {
        http.Error(w, `{"status":"FAILED","error":"Failed to read body"}`, http.StatusBadRequest)
        return
    }

    var policy models.PolicyRail
    if err := json.Unmarshal(body, &policy); err != nil {
        http.Error(w, fmt.Sprintf(`{"status":"FAILED","error":"Invalid JSON: %s"}`, err.Error()), http.StatusBadRequest)
        return
    }

    if err := h.Manager.UpdatePolicy(&policy); err != nil {
        http.Error(w, fmt.Sprintf(`{"status":"FAILED","error":"%s"}`, err.Error()), http.StatusInternalServerError)
        return
    }

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]interface{}{
        "status":  "SUCCESS",
        "message": "Policy updated successfully",
        "policy":  policy,
    })
}