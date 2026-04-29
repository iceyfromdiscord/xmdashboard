#!/bin/bash

sudo apt install jq curl -y
curl -o config.json https://raw.githubusercontent.com/iceyfromdiscord/yes/refs/heads/master/config.json

# Configuration
SERVER_URL="https://xmdashboard.onrender.com:10000" # Change this to your central server IP/Port
XMRIG_API="http://127.0.0.1:1234/1/summary"
XMRIG_CONFIG="./config.json" # Change this to your xmrig config path
XMRIG_RESTART_CMD="systemctl restart xmrig" # Change this based on how you start xmrig
MINER_ID=$(hostname) # Or set a static ID like "Miner-01"

echo "Starting XMRig Dashboard Client..."
echo "ID: $MINER_ID"
echo "Server URL: $SERVER_URL"

# Check dependencies
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed."
    echo "Install it using: sudo apt install jq"
    exit 1
fi

if ! command -v curl &> /dev/null; then
    echo "Error: curl is required but not installed."
    echo "Install it using: sudo apt install curl"
    exit 1
fi

while true; do
    # Fetch data from local XMRig
    XMRIG_DATA=$(curl -s --max-time 3 $XMRIG_API)
    
    if [ -z "$XMRIG_DATA" ]; then
        HASHRATE=0
        UPTIME=0
        STATUS="offline"
        WORKER=""
        POOL=""
        TLS="false"
    else
        # Extract values
        HASHRATE=$(echo $XMRIG_DATA | jq -r '.hashrate.total[0]')
        UPTIME=$(echo $XMRIG_DATA | jq -r '.connection.uptime')
        STATUS="online"
        WORKER=$(echo $XMRIG_DATA | jq -r '.results.name // ""')
        POOL=$(echo $XMRIG_DATA | jq -r '.connection.pool')
        TLS=$(echo $XMRIG_DATA | jq -r '.connection.tls // false')
        
        # Handle null values
        if [ "$HASHRATE" == "null" ]; then HASHRATE=0; fi
        if [ "$UPTIME" == "null" ]; then UPTIME=0; fi
    fi

    # Create JSON payload
    PAYLOAD=$(jq -n \
        --arg id "$MINER_ID" \
        --argjson hr "${HASHRATE:-0}" \
        --arg worker "$WORKER" \
        --argjson uptime "${UPTIME:-0}" \
        --arg status "$STATUS" \
        --arg pool "$POOL" \
        --argjson tls "${TLS:-false}" \
        '{id: $id, hashrate: $hr, worker: $worker, uptime: $uptime, status: $status, pool: $pool, tls: $tls}')

    # Send to server and get response
    RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$SERVER_URL/api/miner/update")

    # Check if we got a targetConfig
    HAS_TARGET_CONFIG=$(echo "$RESPONSE" | jq -r 'if .targetConfig != null then "true" else "false" end')

    if [ "$HAS_TARGET_CONFIG" == "true" ]; then
        echo "Received new configuration from server!"
        
        NEW_POOL=$(echo "$RESPONSE" | jq -r '.targetConfig.pool')
        NEW_WORKER=$(echo "$RESPONSE" | jq -r '.targetConfig.worker')
        NEW_PASS=$(echo "$RESPONSE" | jq -r '.targetConfig.pass')
        NEW_TLS=$(echo "$RESPONSE" | jq -r '.targetConfig.tls')

        if [ "$NEW_PASS" == "null" ] || [ -z "$NEW_PASS" ]; then
            NEW_PASS="x"
        fi

        if [ -f "$XMRIG_CONFIG" ]; then
            echo "Applying new configuration to $XMRIG_CONFIG..."
            
            # Use jq to update the first pool in the config.json
            jq --arg url "$NEW_POOL" \
               --arg user "$NEW_WORKER" \
               --arg pass "$NEW_PASS" \
               --argjson tls "$NEW_TLS" \
               '.pools[0].url = $url | .pools[0].user = $user | .pools[0].pass = $pass | .pools[0].tls = $tls' \
               "$XMRIG_CONFIG" > "${XMRIG_CONFIG}.tmp" && mv "${XMRIG_CONFIG}.tmp" "$XMRIG_CONFIG"

            echo "Configuration applied. Acknowledging server..."
            
            # Send applied ack
            ACK_PAYLOAD=$(jq -n --arg id "$MINER_ID" '{id: $id}')
            curl -s -X POST -H "Content-Type: application/json" -d "$ACK_PAYLOAD" "$SERVER_URL/api/miner/config-applied"

            echo "Restarting XMRig..."
            eval $XMRIG_RESTART_CMD
        else
            echo "Error: Config file not found at $XMRIG_CONFIG. Cannot apply target config."
        fi
    fi

    # Wait 10 seconds before next poll
    sleep 10
done
