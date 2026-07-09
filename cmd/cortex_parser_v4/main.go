package main

import (
"fmt"
"log"
"net/http"
"os"
"os/signal"
"syscall"

"github.com/kampalalove/ogencomplex/ingest"
"github.com/kampalalove/ogencomplex/rules"
)

func main() {
basePath, err := os.Getwd()
if err != nil {
log.Fatalf("Failed to get working directory: %s", err)
}

ingestHandler, err := ingest.NewHandler(basePath)
if err != nil {
log.Fatalf("Failed to initialize ingestion handler: %s", err)
}

rulesHandler := rules.NewHandler(basePath)

// Explicitly isolate the catch-all behavior by using a strict Custom Multiplexer
mux := http.NewServeMux()

// Direct explicit routing tracks
mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
w.Header().Set("Content-Type", "application/json")
fmt.Fprintf(w, `{"status":"ok","system":"Cortex-Gordon-V4","region":"EWR"}`)
})

mux.Handle("/rules", rulesHandler)
mux.Handle("/rules/", rulesHandler)

// Fallback route handler handles root queries and ingestion directly
mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
// If it hits exactly root, delegate straight to ingestHandler
if r.URL.Path == "/" || r.URL.Path == "" {
ingestHandler.ServeHTTP(w, r)
return
}
// If it's an unrecognized asset path, reject cleanly instead of bleeding into health metrics
http.NotFound(w, r)
})

port := os.Getenv("PORT")
if port == "" {
port = "3000"
}
serverAddr := "0.0.0.0:" + port

fmt.Printf("🚀 Ogen Complex Webhook running on http://%s\n", serverAddr)

sigChan := make(chan os.Signal, 1)
signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

go func() {
if err := http.ListenAndServe(serverAddr, mux); err != nil {
log.Fatalf("Server execution failed: %s", err)
}
}()

<-sigChan
fmt.Println("\nStopping Webhook runtime engine. Safe exit complete.")
}