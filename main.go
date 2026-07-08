package main

import (
"fmt"
"log"
"net/http"
"os"
"os/signal"
"syscall"

"github.com/kampalalove/ogencomplex/ingest"
)

func main() {
basePath, err := os.Getwd()
if err != nil {
log.Fatalf("Failed to get working directory: %s", err)
}

handler, err := ingest.NewHandler(basePath)
if err != nil {
log.Fatalf("Failed to initialize ingestion handler: %s", err)
}

http.Handle("/", handler)

port := "8080"
serverAddr := "127.0.0.1:" + port

fmt.Printf("🚀 Local Consensus Webhook running securely on http://%s\n", serverAddr)
fmt.Println("Press Ctrl+C to terminate runtime engine.")

sigChan := make(chan os.Signal, 1)
signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

go func() {
if err := http.ListenAndServe(serverAddr, nil); err != nil {
log.Fatalf("Server execution failed: %s", err)
}
}()

<-sigChan
fmt.Println("\nStopping Webhook runtime engine. Safe exit complete.")
}