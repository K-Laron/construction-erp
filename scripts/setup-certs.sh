#!/bin/bash
# Exit on error
set -e

mkdir -p certificates

if ! command -v mkcert &> /dev/null; then
    echo "mkcert could not be found. Please install it first:"
    echo "https://github.com/FiloSottile/mkcert#installation"
    exit 1
fi

echo "Installing local CA..."
mkcert -install

echo "Generating locally-trusted SSL certificates using mkcert..."

mkcert -key-file certificates/key.pem -cert-file certificates/cert.pem \
  construction-erp.local "localhost" "127.0.0.1" "0.0.0.0"

echo "Certificates generated successfully under ./certificates/"
ls -la certificates
