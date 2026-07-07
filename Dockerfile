FROM golang:1.22-alpine AS builder
<<<<<<< HEAD
RUN apk add --no-cache git
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o cortex_parser_v4 ./cmd/cortex_parser_v4

FROM alpine:latest AS runtime
WORKDIR /app
COPY --from=builder /app/cortex_parser_v4 .
EXPOSE 3000
CMD ["./cortex_parser_v4"]
=======

RUN apk add --no-cache git make

WORKDIR /app

# Copy everything (including .git for VCS info)
COPY . .

# Build and verify
RUN make stamp-and-verify

FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /root/

COPY --from=builder /app/bin/cortex_parser_v4 .

EXPOSE 8080

CMD ["./cortex_parser_v4"]
>>>>>>> pr-22-fix
