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

	// Use an explicit ServeMux so that /rules is not shadowed by the root route.
	mux := http.NewServeMux()
	mux.Handle("/rules", rulesHandler)
	mux.Handle("/", ingestHandler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	serverAddr := "0.0.0.0:" + port

	fmt.Printf("🚀 Active Sovereignty Cluster running on http://%s\n", serverAddr)

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