#!/bin/bash
set -euo pipefail

# --------------------------------------------------------------
# CONFIGURATION
# --------------------------------------------------------------
DATA_DIR="./data"
EPHEMERAL_PG_DATA="/tmp/pg_rag_$$"
RANDOM_PORT=$((RANDOM % 10000 + 30000))
PG_PORT=$RANDOM_PORT
PG_LOG="/tmp/pg_rag_$$.log"

EMBED_MODEL="nomic-embed-text"
LLM_MODEL="llama3.1:8b-instruct-q4_K_M"

# --------------------------------------------------------------
# ARGUMENTS
# --------------------------------------------------------------
VERBOSE=false
INGEST=false
INGEST_DIR=""
QUESTION_PARTS=()
MAJOR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --verbose)
            VERBOSE=true
            shift
            ;;
        --ingest)
            INGEST=true
            if [[ $# -lt 2 ]]; then
                echo "❌ Missing directory after --ingest"
                exit 1
            fi
            INGEST_DIR="$2"
            shift 2
            ;;
        --reset)
            # Kept for CLI compatibility. The database is ephemeral, so every run is reset.
            shift
            ;;
        --major)
            if [[ $# -lt 2 ]]; then
                echo "❌ Missing value after --major"
                exit 1
            fi
            MAJOR="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage:"
            echo "  ./ask.sh --ingest ./pdfs"
            echo "  ./ask.sh \"What is the roofline model?\" --major HPC-Architecture"
            echo "  ./ask.sh --major HPC-Architecture \"What is the roofline model?\""
            exit 0
            ;;
        *)
            QUESTION_PARTS+=("$1")
            shift
            ;;
    esac
done

QUESTION="${QUESTION_PARTS[*]}"

if [[ -z "$QUESTION" && "$INGEST" == false ]]; then
    echo "❌ No question provided. Usage: ./ask.sh \"What is X?\" --major MajorName"
    exit 1
fi

if [[ "$INGEST" == false && -z "$MAJOR" ]]; then
    echo "❌ Missing --major MajorName for query mode."
    exit 1
fi

# --------------------------------------------------------------
# HELPERS
# --------------------------------------------------------------
print_step() {
    if [[ "$VERBOSE" == true ]]; then
        echo -e "$1"
    else
        if [[ "$1" =~ ^❌ ]]; then
            echo -e "$1"
        fi
    fi
}

json_payload() {
    jq -nc --arg model "$1" --arg prompt "$2" '{model:$model,prompt:$prompt}'
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || MISSING="$MISSING $1"
}

PG_STARTED=false
cleanup() {
    if [[ "$PG_STARTED" == true ]]; then
        print_step "🧹 Shutting down ephemeral PostgreSQL..."
        pg_ctl -D "$PGDATA" stop >/dev/null 2>&1 || true
    fi
    rm -rf "$EPHEMERAL_PG_DATA"
    print_step "✅ Clean shutdown complete."
}
trap cleanup EXIT

# --------------------------------------------------------------
# 1. Check dependencies
# --------------------------------------------------------------
print_step "🔍 Checking dependencies..."
MISSING=""
require_command psql
require_command initdb
require_command pg_ctl
require_command createdb
require_command ollama
require_command node
require_command jq
require_command curl
require_command lsof

if [[ -n "$MISSING" ]]; then
    echo "❌ Missing:$MISSING"
    echo "   Install with: sudo apt install postgresql postgresql-contrib nodejs npm jq curl lsof"
    echo "   Install Ollama from: https://ollama.com/download"
    exit 1
fi

# --------------------------------------------------------------
# 2. Ensure ephemeral Postgres port is free
# --------------------------------------------------------------
print_step "🧹 Selecting ephemeral PostgreSQL port..."
if lsof -Pi :"$PG_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
    print_step "⚠️  Port $PG_PORT already in use. Trying a different port."
    PG_PORT=$((RANDOM % 10000 + 30000))
fi

# --------------------------------------------------------------
# 3. Ollama check + model pull
# --------------------------------------------------------------
print_step "🧠 Checking Ollama..."
if ! curl -s http://localhost:11434/api/tags >/dev/null; then
    echo "❌ Ollama not running. Start it: ollama serve"
    exit 1
fi

for MODEL in "$EMBED_MODEL" "$LLM_MODEL"; do
    if ! ollama list | awk '{print $1}' | grep -qx "$MODEL"; then
        print_step "⬇️  Pulling $MODEL..."
        ollama pull "$MODEL" >/dev/null 2>&1
    fi
done
print_step "✅ Ollama ready."

# --------------------------------------------------------------
# 4. Ephemeral PostgreSQL instance
# --------------------------------------------------------------
print_step "🐘 Starting ephemeral PostgreSQL on port $PG_PORT..."
export PGDATA="$EPHEMERAL_PG_DATA"
export PGLOG="$PG_LOG"
initdb -D "$PGDATA" --username=postgres --auth-local=trust --auth-host=trust >/dev/null 2>&1
echo "port = $PG_PORT" >> "$PGDATA/postgresql.conf"
echo "listen_addresses = 'localhost'" >> "$PGDATA/postgresql.conf"
pg_ctl -D "$PGDATA" -l "$PGLOG" start >/dev/null 2>&1
PG_STARTED=true
sleep 1
createdb -h localhost -p "$PG_PORT" -U postgres sovereign_rag
DB_URL="postgresql://postgres@localhost:$PG_PORT/sovereign_rag"

# --------------------------------------------------------------
# 5. Create vector extension and table
# --------------------------------------------------------------
print_step "🗄️  Initializing vector database..."
if ! psql "$DB_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1; then
    echo "❌ PostgreSQL pgvector extension is not available."
    echo "   Install pgvector for this PostgreSQL version, then retry."
    exit 1
fi

psql "$DB_URL" -c "CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    embedding VECTOR(768) NOT NULL,
    metadata JSONB NOT NULL
);" >/dev/null 2>&1

# --------------------------------------------------------------
# 6. Ingest PDFs if requested
# --------------------------------------------------------------
if [[ "$INGEST" == true ]]; then
    if [[ -z "$INGEST_DIR" || ! -d "$INGEST_DIR" ]]; then
        echo "❌ Invalid ingest directory: $INGEST_DIR"
        exit 1
    fi

    print_step "📄 Ingesting PDFs from $INGEST_DIR..."
    DB_URL="$DB_URL" INGEST_DIR="$INGEST_DIR" EMBED_MODEL="$EMBED_MODEL" node <<'NODE'
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const pdf = require('pdf-parse');

const pool = new Pool({ connectionString: process.env.DB_URL });
const ingestDir = process.env.INGEST_DIR;
const embedModel = process.env.EMBED_MODEL;

const walk = (dir) => {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat && stat.isDirectory()) results = results.concat(walk(full));
    else if (full.toLowerCase().endsWith('.pdf')) results.push(full);
  });
  return results;
};

(async () => {
  const files = walk(ingestDir);
  for (const file of files) {
    const major = path.basename(path.dirname(file));
    const dataBuffer = fs.readFileSync(file);
    const data = await pdf(dataBuffer);
    const text = data.text || '';
    const chunkSize = 1000;
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i].trim();
      if (chunk.length < 50) continue;
      const embRes = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: embedModel, prompt: chunk }),
      });
      if (!embRes.ok) throw new Error(`Embedding failed for ${file}: ${embRes.status}`);
      const { embedding } = await embRes.json();
      await pool.query(
        'INSERT INTO documents (content, embedding, metadata) VALUES ($1, $2::vector, $3)',
        [chunk, `[${embedding.join(',')}]`, { major, source: path.basename(file), chunk: i }]
      );
    }
  }
  await pool.end();
})().catch(async (error) => {
  await pool.end().catch(() => {});
  console.error(error.message);
  process.exit(1);
});
NODE
    print_step "✅ Ingestion complete."
    exit 0
fi

# --------------------------------------------------------------
# 7. Ensure at least one document exists for the major (test doc if empty)
# --------------------------------------------------------------
COUNT=$(psql -t -A "$DB_URL" -v major="$MAJOR" -c "SELECT COUNT(*) FROM documents WHERE metadata->>'major' = :'major';" 2>/dev/null | xargs)
if [[ "$COUNT" -eq 0 ]]; then
    if [[ "$VERBOSE" == true ]]; then
        echo "⚠️  No documents for major '$MAJOR'. Inserting a test entry."
    fi
    TEST_PROMPT="The roofline model ties peak FLOPs to memory bandwidth."
    TEST_EMB=$(curl -s -X POST http://localhost:11434/api/embeddings \
        -H "Content-Type: application/json" \
        -d "$(json_payload "$EMBED_MODEL" "$TEST_PROMPT")" | jq -c '.embedding')
    TEST_META=$(jq -nc --arg major "$MAJOR" --arg source "auto-test" '{major:$major,source:$source}')
    psql "$DB_URL" \
        -v embedding="$TEST_EMB" \
        -v metadata="$TEST_META" \
        -c "INSERT INTO documents (content, embedding, metadata) VALUES ('The roofline model ties peak FLOPs to memory bandwidth. Operational intensity = FLOPs/byte.', :'embedding'::vector, :'metadata'::jsonb);" >/dev/null 2>&1
fi

# --------------------------------------------------------------
# 8. Embed the question
# --------------------------------------------------------------
print_step "🔍 Embedding question..."
Q_EMB=$(curl -s -X POST http://localhost:11434/api/embeddings \
    -H "Content-Type: application/json" \
    -d "$(json_payload "$EMBED_MODEL" "$QUESTION")" | jq -c '.embedding')
if [[ -z "$Q_EMB" || "$Q_EMB" == "null" ]]; then
    echo "❌ Failed to generate embedding."
    exit 1
fi

# --------------------------------------------------------------
# 9. Vector search (metadata filter)
# --------------------------------------------------------------
print_step "📚 Retrieving context (major: $MAJOR)..."
CONTEXT_JSON=$(psql -t -A "$DB_URL" \
    -v major="$MAJOR" \
    -v embedding="$Q_EMB" \
    -c "
    SELECT json_agg(json_build_object('content', content, 'source', metadata->>'source'))
    FROM (
        SELECT content, metadata
        FROM documents
        WHERE metadata->>'major' = :'major'
        ORDER BY embedding <=> :'embedding'::vector
        LIMIT 3
    ) sub;
" 2>/dev/null)

if [[ -z "$CONTEXT_JSON" || "$CONTEXT_JSON" == "null" ]]; then
    echo "❌ No context found for major '$MAJOR'."
    exit 1
fi

# --------------------------------------------------------------
# 10. Stream answer from Llama
# --------------------------------------------------------------
print_step "🤖 Generating answer..."
CONTEXT_TEXT=$(echo "$CONTEXT_JSON" | jq -r '.[] | "[\(.source)] \(.content)"' | tr '\n' ' ')
PROMPT="Answer using only the context. Context: $CONTEXT_TEXT\n\nQuestion: $QUESTION\nAnswer:"

curl -N -s -X POST http://localhost:11434/api/generate \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg model "$LLM_MODEL" --arg prompt "$PROMPT" '{model:$model,prompt:$prompt,stream:true}')" \
    | while IFS= read -r line; do
        if [[ -n "$line" ]]; then
            RESP=$(echo "$line" | jq -r '.response // empty' 2>/dev/null)
            if [[ -n "$RESP" ]]; then
                printf "%s" "$RESP"
            fi
        fi
    done

echo ""
print_step "✅ Done."
