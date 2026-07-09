package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/kampalalove/ogencomplex/audit"
	"github.com/kampalalove/ogencomplex/cache"
	"github.com/kampalalove/ogencomplex/health"
	"github.com/kampalalove/ogencomplex/ingest"
	"github.com/kampalalove/ogencomplex/metrics"
	"github.com/kampalalove/ogencomplex/ratelimit"
	"github.com/kampalalove/ogencomplex/rules"
)

func main() {
	basePath, err := os.Getwd()
	if err != nil {
		log.Fatalf("Failed to get working directory: %s", err)
	}

	// --- Node identity ---
	nodeID := nodeIdentity()
	region := envOr("FLY_REGION", "local")

	// --- Subsystem initialisation ---
	auditLogger := audit.New(basePath, nodeID, region)
	profileCache := cache.New(basePath)
	limiter := ratelimit.NewDefault()
	collector := metrics.New(profileCache, limiter, auditLogger, nodeID, region)

	// --- Handlers ---
	ingestHandler, err := ingest.NewHandler(basePath)
	if err != nil {
		log.Fatalf("Failed to initialize ingestion handler: %s", err)
	}
	ingestHandler.Cache = profileCache
	ingestHandler.AuditLogger = auditLogger

	rulesHandler := rules.NewHandler(basePath)
	healthHandler := health.New(nodeID, region)
	metricsHandler := metrics.NewHandler(collector)

	// --- Routing ---
	mux := http.NewServeMux()
	mux.Handle("/health", healthHandler)
	mux.Handle("/metrics", metricsHandler)
	mux.Handle("/rules", rulesHandler)
	mux.Handle("/rules/", rulesHandler)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "" {
			http.NotFound(w, r)
			return
		}
		ingestHandler.ServeHTTP(w, r)
	})

	// --- Middleware stack (outermost first) ---
	var handler http.Handler = mux
	handler = metricsMiddleware(collector, handler)
	handler = securityMiddleware(handler)
	handler = limiter.Middleware(handler)

	// --- Server ---
	port := envOr("PORT", "3000")
	serverAddr := "0.0.0.0:" + port
	fmt.Printf("🚀 Ogen Complex Webhook running on http://%s (node=%s region=%s)\n", serverAddr, nodeID, region)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		if err := http.ListenAndServe(serverAddr, handler); err != nil {
			log.Fatalf("Server execution failed: %s", err)
		}
	}()

	<-sigChan
	fmt.Println("\nStopping Webhook runtime engine — flushing state...")
	profileCache.Close()
	auditLogger.Close()
	limiter.Close()
	fmt.Println("Safe exit complete.")
}

// --- Middleware ---

// securityMiddleware injects HSTS headers and validates HMAC request signatures
// when the HMAC_SECRET environment variable is set.
func securityMiddleware(next http.Handler) http.Handler {
	secret := os.Getenv("HMAC_SECRET")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// HSTS — tell clients to use HTTPS for 1 year.
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")

		// Optional HMAC signature validation for mutating requests.
		if secret != "" && r.Method == http.MethodPost {
			sig := r.Header.Get("X-Signature")
			if sig == "" {
				http.Error(w, `{"status":"FAILED","error":"Missing X-Signature header"}`, http.StatusUnauthorized)
				return
			}
			if !validHMAC(secret, r.Header.Get("X-Request-Body-Hash"), sig) {
				http.Error(w, `{"status":"FAILED","error":"Invalid request signature"}`, http.StatusUnauthorized)
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}

// metricsMiddleware records each request in the collector.
func metricsMiddleware(col *metrics.Collector, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rw := &captureWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(rw, r)
		col.RecordRequest()
		if rw.statusCode >= 400 {
			col.RecordError()
		}
	})
}

// captureWriter records the first status code written for metrics tracking.
// It does not override Write so that data flows directly to the underlying
// ResponseWriter without an extra passthrough path.
type captureWriter struct {
	http.ResponseWriter
	statusCode int
	written    bool
}

func (cw *captureWriter) WriteHeader(code int) {
	if !cw.written {
		cw.statusCode = code
		cw.written = true
		cw.ResponseWriter.WriteHeader(code)
	}
}

// --- Helpers ---

// nodeIdentity returns FLY_MACHINE_ID if set, otherwise a random 8-byte hex.
func nodeIdentity() string {
	if id := os.Getenv("FLY_MACHINE_ID"); id != "" {
		return id
	}
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "unknown"
	}
	return hex.EncodeToString(b)
}

// envOr returns the value of the named env var or the fallback.
func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// validHMAC verifies that sig == HMAC-SHA256(secret, bodyHash).
func validHMAC(secret, bodyHash, sig string) bool {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(bodyHash))
	expected := hex.EncodeToString(mac.Sum(nil))
	// Constant-time comparison.
	return hmac.Equal([]byte(expected), []byte(sig))
}