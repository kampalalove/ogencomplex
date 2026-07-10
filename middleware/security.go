package middleware

import (
    "bytes"
    "crypto/hmac"
    "crypto/sha256"
    "encoding/base64"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
    "regexp"
    "strings"
    "sync"
    "time"
)

// SecurityHeaders middleware adds security headers to every response
func SecurityHeaders(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
        w.Header().Set("X-Content-Type-Options", "nosniff")
        w.Header().Set("X-Frame-Options", "DENY")
        w.Header().Set("X-XSS-Protection", "1; mode=block")
        w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
        w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        next.ServeHTTP(w, r)
    })
}

// RateLimiter middleware with X-Forwarded-For parsing
type RateLimiter struct {
    mu       sync.RWMutex
    requests map[string][]time.Time
    limit    int
    window   time.Duration
    enabled  bool
}

func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
    return &RateLimiter{
        requests: make(map[string][]time.Time),
        limit:    limit,
        window:   window,
        enabled:  limit > 0,
    }
}

func (rl *RateLimiter) getClientIP(r *http.Request) string {
    // Parse X-Forwarded-For for first IP (prevents bypass)
    if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
        ips := strings.Split(xff, ",")
        if len(ips) > 0 {
            return strings.TrimSpace(ips[0])
        }
    }
    // Fallback to direct remote address
    ip := strings.Split(r.RemoteAddr, ":")[0]
    return ip
}

func (rl *RateLimiter) Allow(r *http.Request) bool {
    if !rl.enabled {
        return true
    }

    ip := rl.getClientIP(r)
    rl.mu.Lock()
    defer rl.mu.Unlock()

    now := time.Now()
    if _, exists := rl.requests[ip]; !exists {
        rl.requests[ip] = []time.Time{now}
        return true
    }

    // Clean old requests
    var valid []time.Time
    for _, t := range rl.requests[ip] {
        if now.Sub(t) < rl.window {
            valid = append(valid, t)
        }
    }

    if len(valid) >= rl.limit {
        return false
    }

    valid = append(valid, now)
    rl.requests[ip] = valid
    return true
}

func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if !rl.Allow(r) {
            w.Header().Set("Content-Type", "application/json")
            w.Header().Set("Retry-After", fmt.Sprintf("%d", int(rl.window.Seconds())))
            w.WriteHeader(http.StatusTooManyRequests)
            json.NewEncoder(w).Encode(map[string]interface{}{
                "status":      "FAILED",
                "error":       "Rate limit exceeded",
                "limit":       rl.limit,
                "window":      rl.window.String(),
                "retry_after": fmt.Sprintf("%ds", int(rl.window.Seconds())),
            })
            return
        }
        next.ServeHTTP(w, r)
    })
}

// HMACValidator validates HMAC-SHA256 signatures on POST requests
type HMACValidator struct {
    secret  []byte
    enabled bool
}

func NewHMACValidator() *HMACValidator {
    secret := os.Getenv("HMAC_SECRET")
    return &HMACValidator{
        secret:  []byte(secret),
        enabled: secret != "",
    }
}

func (h *HMACValidator) Validate(r *http.Request) bool {
    if !h.enabled {
        return true
    }

    if r.Method != http.MethodPost {
        return true
    }

    signature := r.Header.Get("X-HMAC-Signature")
    if signature == "" {
        return false
    }

    body, err := io.ReadAll(r.Body)
    if err != nil {
        return false
    }
    // Restore body for subsequent reads
    r.Body = io.NopCloser(bytes.NewBuffer(body))

    mac := hmac.New(sha256.New, h.secret)
    mac.Write(body)
    expected := base64.URLEncoding.EncodeToString(mac.Sum(nil))

    return hmac.Equal([]byte(signature), []byte(expected))
}

func (h *HMACValidator) Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if !h.Validate(r) {
            w.Header().Set("Content-Type", "application/json")
            w.WriteHeader(http.StatusUnauthorized)
            json.NewEncoder(w).Encode(map[string]interface{}{
                "status": "FAILED",
                "error":  "Invalid or missing HMAC signature",
            })
            return
        }
        next.ServeHTTP(w, r)
    })
}

// PathSanitizer prevents directory traversal attacks
func PathSanitizer(systemID string) string {
    // Block raw traversal
    if strings.Contains(systemID, "..") ||
        strings.Contains(systemID, "/") ||
        strings.Contains(systemID, "\\") ||
        strings.Contains(systemID, "\x00") {
        return ""
    }

    // Block URL-encoded variants
    if strings.Contains(systemID, "%2e%2e") ||
        strings.Contains(systemID, "%2E%2E") ||
        strings.Contains(systemID, "%252e") {
        return ""
    }

    // Block path separator variants
    if strings.Contains(systemID, "%2f") ||
        strings.Contains(systemID, "%5c") {
        return ""
    }

    // Allow only alphanumeric, dash, underscore
    matched, _ := regexp.MatchString(`^[a-zA-Z0-9\-_]+$`, systemID)
    if !matched {
        return ""
    }

    return systemID
}