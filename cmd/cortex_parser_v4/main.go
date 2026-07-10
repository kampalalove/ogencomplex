package main

import (
    "context"
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/kampalalove/ogencomplex/audit"
    "github.com/kampalalove/ogencomplex/cache"
    "github.com/kampalalove/ogencomplex/ingest"
    "github.com/kampalalove/ogencomplex/middleware"
    "github.com/kampalalove/ogencomplex/rules"
    "github.com/kampalalove/ogencomplex/state"
)

func main() {
    basePath, err := os.Getwd()
    if err != nil {
        log.Fatalf("Failed to get working directory: %s", err)
    }

    // Initialize distributed state
    distState := state.NewDistributedState()
    nodeInfo := distState.GetNodeInfo()

    // Initialize async audit logger
    auditLogger, err := audit.NewAsyncLogger(basePath, nodeInfo.NodeID, nodeInfo.Region, 10000, 100)
    if err != nil {
        log.Fatalf("Failed to initialize audit logger: %s", err)
    }
    defer auditLogger.Close()

    // Initialize write-through cache
    wtCache := cache.NewWriteThroughCache(basePath)
    defer wtCache.Close()

    // Initialize rule manager
    rulesManager := rules.NewManager(basePath)

    // Initialize handlers
    ingestHandler, err := ingest.NewHandler(basePath, rulesManager, distState, auditLogger, wtCache)
    if err != nil {
        log.Fatalf("Failed to initialize ingestion handler: %s", err)
    }

    // Create multiplexer with explicit routing
    mux := http.NewServeMux()

    // Health endpoint
    mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        fmt.Fprintf(w, `{"status":"ok","system":"Cortex-Gordon-V4","region":"%s","node":"%s"}`,
            nodeInfo.Region, nodeInfo.NodeID[:8])
    })

    // Metrics endpoint
    mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        stats := map[string]interface{}{
            "node":  distState.GetStats(),
            "cache": wtCache.Stats(),
        }
        json.NewEncoder(w).Encode(stats)
    })

    // Rules endpoints
    rulesHandler := rules.NewHandler(basePath)
    mux.Handle("/rules", rulesHandler)
    mux.Handle("/rules/", rulesHandler)

    // Root handler for ingestion
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        if r.URL.Path == "/" || r.URL.Path == "" {
            ingestHandler.ServeHTTP(w, r)
            return
        }
        http.NotFound(w, r)
    })

    // Apply security middleware chain
    handler := middleware.SecurityHeaders(
        middleware.NewRateLimiter(10, 60*time.Second).Middleware(
            middleware.NewHMACValidator().Middleware(mux),
        ),
    )

    port := os.Getenv("PORT")
    if port == "" {
        port = "3000"
    }
    serverAddr := "0.0.0.0:" + port

    server := &http.Server{
        Addr:         serverAddr,
        Handler:      handler,
        ReadTimeout:  15 * time.Second,
        WriteTimeout: 30 * time.Second,
        IdleTimeout:  120 * time.Second,
    }

    fmt.Printf("🚀 Ogen Complex Webhook running on http://%s\n", serverAddr)
    fmt.Printf("📡 Node: %s | Region: %s\n", nodeInfo.NodeID[:8], nodeInfo.Region)
    fmt.Println("📡 Routes:")
    fmt.Println("   GET  /health           - Health check")
    fmt.Println("   GET  /metrics          - Performance metrics")
    fmt.Println("   POST /                 - Ingest AI fragment")
    fmt.Println("   GET  /rules            - List policy rules")
    fmt.Println("   POST /rules            - Update policy rules")
    fmt.Println("🔒 Security: HSTS | XFO | XSS | Rate Limit | HMAC (opt)")
    fmt.Println("Press Ctrl+C to terminate.")

    // Graceful shutdown
    sigChan := make(chan os.Signal, 1)
    signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

    go func() {
        if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Fatalf("Server execution failed: %s", err)
        }
    }()

    <-sigChan
    fmt.Println("\n🛑 Received shutdown signal. Draining active connections...")

    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    if err := server.Shutdown(ctx); err != nil {
        log.Printf("Shutdown error: %v", err)
    }

    fmt.Println("✅ Shutdown complete. Goodbye.")
}