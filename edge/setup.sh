#!/usr/bin/env bash
# Invisi Edge Setup — installs Mosquitto + Redis on Raspberry Pi

set -euo pipefail

echo "=== Invisi Edge Setup ==="

sudo apt update && sudo apt upgrade -y

# Mosquitto MQTT broker
echo "Installing Mosquitto..."
sudo apt install -y mosquitto mosquitto-clients
sudo cp "$(dirname "$0")/mosquitto.conf" /etc/mosquitto/conf.d/invisi.conf
sudo systemctl enable mosquitto
sudo systemctl restart mosquitto
echo "Mosquitto running on port 1883"

# Redis
echo "Installing Redis..."
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl restart redis-server
echo "Redis running on port 6379"

# Bun runtime
if ! command -v bun &> /dev/null; then
    echo "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

# Install telemetry dependencies
echo "Installing telemetry dependencies..."
cd "$(dirname "$0")/../nextjs-app"
bun install

# Install systemd service
echo "Installing systemd service..."
sudo cp "$(dirname "$0")/invisi-telemetry.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable invisi-telemetry
sudo systemctl start invisi-telemetry

echo "=== Setup complete ==="
echo "Mosquitto: mqtt://$(hostname -I | awk '{print $1}'):1883"
echo "Redis:     redis://localhost:6379"
echo "Telemetry: systemctl status invisi-telemetry"
