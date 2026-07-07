FROM golang:1.22-alpine AS builder
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