#include <DallasTemperature.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

// =========================================================================
// 1. CONFIGURATION
// =========================================================================

const char *ssid = "ASHESI-GUEST";
const char *password = "7daysaWEEK";

const char *mqtt_server = "175d3f6bef384d07b45f87e538953408.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char *mqtt_username = "Invisi";
const char *mqtt_password = "Invisi2026";

const char *supabase_url = "https://ivifglrpwgxbncobkxng.supabase.co";
const char *supabase_anon_key =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aWZnbHJwd2d4Ym5jb2JreG5nIiwicm9sZSI6Im"
    "Fub24iLCJpYXQiOjE3NzMwNTExMjksImV4cCI6MjA4ODYyNzEyOX0.lZ473c8-2-IUU7q-h-"
    "JDh2C1xU5j_VfP9A09XlupTtE";

// Deep sleep duration: 30 minutes (in microseconds)
#define SLEEP_DURATION_US (30 * 60 * 1000000ULL)

// =========================================================================
// 2. HARDWARE PINS
// =========================================================================

// DS18B20 Temperature Sensors
#define TEMP_CENTER_PIN 19 // Red — center of bean mass
#define TEMP_LEFT_PIN 18   // Green — left edge
#define TEMP_RIGHT_PIN 5   // Blue — right edge

// MQ-135 Gas Sensors — moved to ADC1 pins (ADC2 conflicts with WiFi)
#define GAS_LEFT_PIN 32  // Green wire — top lid, left side
#define GAS_RIGHT_PIN 33 // Yellow wire — top lid, right side

// =========================================================================
// 3. SENSOR OBJECTS
// =========================================================================

OneWire owCenter(TEMP_CENTER_PIN);
OneWire owLeft(TEMP_LEFT_PIN);
OneWire owRight(TEMP_RIGHT_PIN);

DallasTemperature sensorCenter(&owCenter);
DallasTemperature sensorLeft(&owLeft);
DallasTemperature sensorRight(&owRight);

WiFiClientSecure espClient;
PubSubClient client(espClient);

// =========================================================================
// 4. SENSOR READINGS (read BEFORE WiFi to avoid ADC2 conflict + heat)
// =========================================================================

// Stored globally so they survive between function calls in setup()
float tempCenter, tempLeft, tempRight;
int gasLeft, gasRight;
bool centerOk, leftOk, rightOk;

void readAllSensors() {
  // Initialize temperature sensors
  sensorCenter.begin();
  sensorLeft.begin();
  sensorRight.begin();

  // Read temperatures
  sensorCenter.requestTemperatures();
  sensorLeft.requestTemperatures();
  sensorRight.requestTemperatures();

  tempCenter = sensorCenter.getTempCByIndex(0);
  tempLeft = sensorLeft.getTempCByIndex(0);
  tempRight = sensorRight.getTempCByIndex(0);

  centerOk = (tempCenter != DEVICE_DISCONNECTED_C);
  leftOk = (tempLeft != DEVICE_DISCONNECTED_C);
  rightOk = (tempRight != DEVICE_DISCONNECTED_C);

  // Read gas sensors (ADC1 pins, safe even with WiFi, but we read early anyway)
  pinMode(GAS_LEFT_PIN, INPUT);
  pinMode(GAS_RIGHT_PIN, INPUT);
  gasLeft = analogRead(GAS_LEFT_PIN);
  gasRight = analogRead(GAS_RIGHT_PIN);

  // Debug print
  Serial.println("\n--- Sensor Readings ---");
  Serial.print("Temp Center: ");
  Serial.print(centerOk ? String(tempCenter) : "ERR");
  Serial.println(" C");
  Serial.print("Temp Left:   ");
  Serial.print(leftOk ? String(tempLeft) : "ERR");
  Serial.println(" C");
  Serial.print("Temp Right:  ");
  Serial.print(rightOk ? String(tempRight) : "ERR");
  Serial.println(" C");
  Serial.print("Gas Left:  ");
  Serial.println(gasLeft);
  Serial.print("Gas Right: ");
  Serial.println(gasRight);

  // Thermal gradient check
  if (centerOk) {
    float edgeSum = 0;
    int edgeCount = 0;
    if (leftOk) {
      edgeSum += tempLeft;
      edgeCount++;
    }
    if (rightOk) {
      edgeSum += tempRight;
      edgeCount++;
    }
    if (edgeCount > 0) {
      float gradient = tempCenter - (edgeSum / edgeCount);
      Serial.print("Thermal Gradient: ");
      Serial.print(gradient, 1);
      Serial.println(" C");
      if (gradient > 5.0) {
        Serial.println(">> TURNING RECOMMENDED <<");
      }
    }
  }
}

// =========================================================================
// 5. NETWORK HELPERS
// =========================================================================

void connectWiFi() {
  Serial.print("WiFi: ");
  Serial.println(ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nConnected! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\nWiFi failed. Going back to sleep.");
    goToSleep();
  }
}

String fetchActiveBatchId() {
  HTTPClient http;
  String url =
      String(supabase_url) +
      "/rest/v1/"
      "batches?status=eq.fermenting&order=created_at.desc&limit=1&select=id";

  http.begin(url);
  http.addHeader("apikey", supabase_anon_key);
  http.addHeader("Authorization", String("Bearer ") + supabase_anon_key);

  int httpCode = http.GET();
  if (httpCode == 200) {
    String response = http.getString();
    int idStart = response.indexOf("\"id\":\"");
    if (idStart >= 0) {
      idStart += 6;
      int idEnd = response.indexOf("\"", idStart);
      if (idEnd > idStart) {
        String id = response.substring(idStart, idEnd);
        http.end();
        return id;
      }
    }
  } else {
    Serial.print("Batch lookup failed, HTTP: ");
    Serial.println(httpCode);
  }
  http.end();
  return "";
}

bool connectMQTT() {
  espClient.setInsecure();
  client.setServer(mqtt_server, mqtt_port);

  String clientId = "InvisiPod-";
  clientId += String(random(0xffff), HEX);

  int attempts = 0;
  while (!client.connected() && attempts < 3) {
    Serial.print("MQTT: connecting...");
    if (client.connect(clientId.c_str(), mqtt_username, mqtt_password)) {
      Serial.println(" OK!");
      return true;
    }
    Serial.print(" Failed (rc=");
    Serial.print(client.state());
    Serial.println("). Retry...");
    delay(2000);
    attempts++;
  }
  return false;
}

// =========================================================================
// 6. DEEP SLEEP
// =========================================================================

void goToSleep() {
  Serial.print("Sleeping for ");
  Serial.print(SLEEP_DURATION_US / 1000000ULL);
  Serial.println(" seconds...");
  Serial.flush();

  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);

  esp_sleep_enable_timer_wakeup(SLEEP_DURATION_US);
  esp_deep_sleep_start();
  // Execution stops here. On wake, setup() runs from scratch.
}

// =========================================================================
// 7. MAIN — runs once per wake cycle, then sleeps
// =========================================================================

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n--- Invisi Pod: Wake Cycle ---");

  // Step 1: Read all sensors BEFORE WiFi (avoids ADC2 conflict + heat)
  readAllSensors();

  // Step 2: Connect WiFi
  connectWiFi();

  // Step 3: Fetch active batch
  String batchId = fetchActiveBatchId();
  if (batchId.length() == 0) {
    Serial.println("No active batch. Sleeping.");
    goToSleep();
    return;
  }
  Serial.print("Batch: ");
  Serial.println(batchId);

  // Step 4: Connect MQTT
  if (!connectMQTT()) {
    Serial.println("MQTT failed. Sleeping.");
    goToSleep();
    return;
  }

  // Step 5: Build and publish JSON payload
  char topic[128];
  snprintf(topic, sizeof(topic), "invisi/pod/%s/telemetry", batchId.c_str());

  String payload = "{";
  payload += "\"batch_id\":\"" + batchId + "\"";
  if (centerOk)
    payload += ",\"temp_center\":" + String(tempCenter, 2);
  if (leftOk)
    payload += ",\"temp_left\":" + String(tempLeft, 2);
  if (rightOk)
    payload += ",\"temp_right\":" + String(tempRight, 2);
  payload += ",\"gas_left\":" + String(gasLeft);
  payload += ",\"gas_right\":" + String(gasRight);
  payload += "}";

  Serial.print("-> ");
  Serial.println(payload);

  if (client.publish(topic, payload.c_str())) {
    Serial.println("Published OK");
  } else {
    Serial.println("Publish FAILED");
  }

  // Give MQTT a moment to flush the packet
  client.loop();
  delay(500);
  client.disconnect();

  // Step 6: Sleep
  goToSleep();
}

void loop() {
  // Never reached — setup() always ends with deep sleep
}
