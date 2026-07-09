// Package audit provides an async, non-blocking JSONL audit logger backed by a
// buffered channel. Events that arrive when the buffer is full are dropped
// (select-default architecture) so the hot path is never blocked.
package audit

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

const (
	channelBuffer = 1024
	logFileName   = "audit.jsonl"
	logDir        = "universe.index"
)

// Event is a single structured audit log entry.
type Event struct {
	Timestamp  string `json:"timestamp"`
	IP         string `json:"ip"`
	Method     string `json:"method"`
	Path       string `json:"path"`
	SystemID   string `json:"system_id,omitempty"`
	StatusCode int    `json:"status_code"`
	LatencyMs  int64  `json:"latency_ms"`
	RuleID     string `json:"rule_id,omitempty"`
	Allowed    bool   `json:"allowed"`
	NodeID     string `json:"node_id"`
	Region     string `json:"region"`
}

// Logger drains an event channel in a background goroutine and appends each
// event as a JSON line to a persistent log file.
type Logger struct {
	events   chan Event
	done     chan struct{}
	wg       sync.WaitGroup
	nodeID   string
	region   string
	logPath  string
	mu       sync.Mutex // guards file writes
	dropped  atomic.Int64
	written  atomic.Int64
}

// New creates and starts a Logger. Call Close when the server shuts down.
func New(basePath, nodeID, region string) *Logger {
	if err := os.MkdirAll(filepath.Join(basePath, logDir), 0755); err != nil {
		fmt.Fprintf(os.Stderr, "[audit] failed to create log dir: %v\n", err)
	}
	l := &Logger{
		events:  make(chan Event, channelBuffer),
		done:    make(chan struct{}),
		nodeID:  nodeID,
		region:  region,
		logPath: filepath.Join(basePath, logDir, logFileName),
	}
	l.wg.Add(1)
	go l.drain()
	return l
}

// Emit enqueues an event for async logging. It never blocks; events are dropped
// when the channel is full (non-blocking select-default).
func (l *Logger) Emit(e Event) {
	e.NodeID = l.nodeID
	e.Region = l.region
	if e.Timestamp == "" {
		e.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	select {
	case l.events <- e:
	default:
		l.dropped.Add(1)
	}
}

// Dropped returns the total number of events dropped due to channel saturation.
func (l *Logger) Dropped() int64 { return l.dropped.Load() }

// Written returns the total number of events successfully written.
func (l *Logger) Written() int64 { return l.written.Load() }

// Close flushes remaining events and stops the background goroutine.
func (l *Logger) Close() {
	close(l.done)
	l.wg.Wait()
}

// drain runs in a background goroutine, consuming events from the channel.
func (l *Logger) drain() {
	defer l.wg.Done()
	for {
		select {
		case e := <-l.events:
			l.write(e)
		case <-l.done:
			// Drain any remaining events before exit.
			for {
				select {
				case e := <-l.events:
					l.write(e)
				default:
					return
				}
			}
		}
	}
}

func (l *Logger) write(e Event) {
	data, err := json.Marshal(e)
	if err != nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	f, err := os.OpenFile(l.logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	f.Write(data)
	f.Write([]byte("\n"))
	l.written.Add(1)
}
