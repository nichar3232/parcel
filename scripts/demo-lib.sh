# Shared by demo-devnet.sh and demo-sandbox.sh.

# Stop whatever is listening on the port, politely first.
free_port() {
  local port=$1 pids
  pids=$(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  [ -z "$pids" ] && return 0
  echo "Stopping what is on port $port (pid $(echo $pids | tr ' ' ','))..."
  kill $pids 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.5
    pids=$(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    [ -z "$pids" ] && return 0
  done
  kill -9 $pids 2>/dev/null || true
  sleep 0.5
}
