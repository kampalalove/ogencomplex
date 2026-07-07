FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git make

WORKDIR /app

# Copy everything (including .git for VCS info)
COPY . .
COPY .git .git

# Build and verify
RUN make stamp-and-verify

FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /root/

COPY --from=builder /app/bin/cortex_parser_v4 .

EXPOSE 8080

CMD ["./cortex_parser_v4"]
