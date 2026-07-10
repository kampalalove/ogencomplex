package audit

import (
    "encoding/json"
    "os"
    "path/filepath"
    "sync"
    "time"
)

type AuditEvent struct {
    Timestamp  time.Time `json:"timestamp"`
    IP         string    `json:"ip"`
    Method     string    `json:"method"`
    Path       string    `json:"path"`
    SystemID   string    `json:"system_id,omitempty"`
    StatusCode int       `json:"status_code"`
    LatencyMs  int64     `json:"latency_ms"`
    RuleID     string    `json:"rule_id,omitempty"`
    Allowed    bool      `json:"allowed"`
    NodeID     string    `json:"node_id"`
    Region     string    `json:"region"`
}

type AsyncLogger struct {
    events     chan AuditEvent
    wg         sync.WaitGroup
    writer     *os.File
    batch      []AuditEvent
    batchSize  int
    flushTicker *time.Ticker
    mu         sync.Mutex
    closed     bool
    nodeID     string
    region     string
}

func NewAsyncLogger(basePath, nodeID, region string, bufferSize, batchSize int) (*AsyncLogger, error) {
    logPath := filepath.Join(basePath, "logs", "audit.jsonl")
    os.MkdirAll(filepath.Dir(logPath), 0755)
    
    f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
    if err != nil {
        return nil, err
    }
    
    al := &AsyncLogger{
        events:      make(chan AuditEvent, bufferSize),
        writer:      f,
        batch:       make([]AuditEvent, 0, batchSize),
        batchSize:   batchSize,
        flushTicker: time.NewTicker(5 * time.Second),
        nodeID:      nodeID,
        region:      region,
    }
    
    al.wg.Add(1)
    go al.daemon()
    return al, nil
}

func (al *AsyncLogger) daemon() {
    defer al.wg.Done()
    for {
        select {
        case event, ok := <-al.events:
            if !ok {
                al.flush()
                return
            }
            al.mu.Lock()
            al.batch = append(al.batch, event)
            if len(al.batch) >= al.batchSize {
                al.flush()
            }
            al.mu.Unlock()
        case <-al.flushTicker.C:
            al.mu.Lock()
            if len(al.batch) > 0 {
                al.flush()
            }
            al.mu.Unlock()
        }
    }
}

func (al *AsyncLogger) flush() {
    if len(al.batch) == 0 {
        return
    }
    for _, event := range al.batch {
        data, _ := json.Marshal(event)
        al.writer.Write(append(data, '\n'))
    }
    al.batch = al.batch[:0]
}

func (al *AsyncLogger) Log(event AuditEvent) {
    if al.closed {
        return
    }
    event.NodeID = al.nodeID
    event.Region = al.region
    select {
    case al.events <- event:
    default:
    }
}

func (al *AsyncLogger) Close() error {
    al.mu.Lock()
    if al.closed {
        al.mu.Unlock()
        return nil
    }
    al.closed = true
    al.mu.Unlock()
    
    al.flushTicker.Stop()
    close(al.events)
    al.wg.Wait()
    return al.writer.Close()
}