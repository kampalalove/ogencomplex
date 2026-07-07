package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	_ "github.com/kampalalove/ogencomplex/internal/parser" // triggers init gatekeeper
)

func main() {
	log.Println("✅ Cortex V4 gatekeeper passed. Starting server...")

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "OK - buildinfo verified")
	})

	// Optional: webhook receiver for WamuHub events (we can expand later)
	http.HandleFunc("/webhook/wamuhub", func(w http.ResponseWriter, r *http.Request) {
		// Placeholder for the loan_repaid → Idea Database bridge
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "Webhook received (integration pending)")
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
