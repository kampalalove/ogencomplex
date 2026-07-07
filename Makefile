BIN_DIR := bin
TOOLS_DIR := tools
PARSER ?= cortex_parser_v4
PARSER_BIN := $(BIN_DIR)/$(PARSER)

# -s -w strip debug symbols; -buildid= ensures reproducible builds required by the buildinfo gatekeeper
LDFLAGS := -ldflags="-s -w -buildid="
BUILD_FLAGS := $(LDFLAGS) -trimpath

.PHONY: all build stamp-and-verify clean

all: build stamp-and-verify

build:
	@mkdir -p $(BIN_DIR)
	go build $(BUILD_FLAGS) -o $(PARSER_BIN) ./cmd/$(PARSER)

stamp-and-verify: build
	@echo "🔐 Verifying $(PARSER_BIN)..."
	@go run $(TOOLS_DIR)/verify_cortex_buildinfo.go $(PARSER_BIN)
	@echo "✅ $(PARSER_BIN) verified."

clean:
	rm -rf $(BIN_DIR)
