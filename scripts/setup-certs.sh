#!/bin/bash
# Exit on error
set -e

mkdir -p certificates

echo "Generating self-signed SSL certificates using OpenSSL..."

openssl req -x509 -newkey rsa:2048 \
  -keyout certificates/key.pem \
  -out certificates/cert.pem \
  -sha256 -days 365 -nodes \
  -subj "/CN=construction-erp.local" \
  -addext "subjectAltName=DNS:construction-erp.local,DNS:localhost,IP:127.0.0.1,IP:0.0.0.0"

echo "Certificates generated successfully under ./certificates/"
ls -la certificates
