#!/bin/bash
# Local ERP & POS Application Linux Launcher
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "=============================================="
echo "   Launching Construction Supply ERP & POS    "
echo "=============================================="

# Check if production build exists, otherwise build it
if [ ! -d ".next" ]; then
  echo "Production build folder not found. Building application..."
  npm run build
fi

# Function to check if the server is up
wait_for_server() {
  echo "Waiting for Next.js server to start on port 3000..."
  for i in {1..30}; do
    # Check port 3000 using ss
    if ss -tln | grep -q ":3000 "; then
      echo "Server is live!"
      return 0
    fi
    sleep 1
  done
  echo "Error: Server failed to start in 30 seconds."
  return 1
}

# Start the server in the background
echo "Starting production server..."
npm run start &
SERVER_PID=$!

# Trap exit to kill background server
trap 'kill $SERVER_PID' EXIT

# Wait for server to bind port
if wait_for_server; then
  # Open default web browser in Linux
  URL="http://localhost:3000"
  echo "Opening browser to $URL..."
  
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL"
  elif command -v gio >/dev/null 2>&1; then
    gio open "$URL"
  elif command -v sensible-browser >/dev/null 2>&1; then
    sensible-browser "$URL"
  else
    echo "Could not find a browser launcher utility (xdg-open, gio, sensible-browser)."
    echo "Please open your browser manually and navigate to: $URL"
  fi
  
  # Keep script running to show logs and preserve background process
  wait $SERVER_PID
fi
