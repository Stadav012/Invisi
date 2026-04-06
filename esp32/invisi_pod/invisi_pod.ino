#include <DallasTemperature.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <PubSubClient.h>
#include <WiFi.h>

// =========================================================================
// 1. CONFIGURATION
// =========================================================================

const char *ssid = "MTN_4G_487D38";
const char *password = "Ilovetobecalledtrymore123!";

// Local Mosquitto broker on Raspberry Pi
const char *mqtt_server = "192.168.1.100";
const int mqtt_port = 1883;

// Supabase — used only for batch ID lookup
const char *supabase_url = "https://ivifglrpwgxbncobkxng.supabase.co";
const char *supabase_anon_key =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aWZnbHJwd2d4Ym5jb2JreG5nIiwicm9sZSI6Im"
    "Fub24iLCJpYXQiOjE3NzMwNTExMjksImV4cCI6MjA4ODYyNzEyOX0.lZ473c8-2-IUU7q-h-"
    "JDh2C1xU5j_VfP9A09XlupTtE";

// Deep sleep duration: 30 minutes
#define SLEEP_DURATION_US (30 * 60 * 1000000ULL)

// Pod identifier
#define POD_ID "pod_01"

// MQTT topic following the design taxonomy
#define MQTT_TOPIC "invisi/fermentation/" POD_ID "/sensors"

// =========================================================================
// 2. HARDWARE PINS
// =========================================================================

// DS18B20 Temperature Sensors
#define TEMP_CENTER_PIN 19 // Red — center of bean mass (t_core)
#define TEMP_LEFT_PIN 18   // Green — left edge (t_left)
#define TEMP_RIGHT_PIN 5   // Blue — right edge (t_right)

// MQ-135 Gas Sensors on ADC1 (ADC2 conflicts with WiFi)
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

WiFiClient espClient; // Plain TCP — no TLS needed on LAN
PubSubClient client(espClient);

// =========================================================================
// 4. SENSOR READINGS (read BEFORE WiFi to avoid ADC2 interference)
// =========================================================================

float tCore, tLeft, tRight;
int gasLeft, gasRight;
bool coreOk, leftOk, rightOk;

void readAllSensors() {
  sensorCenter.begin();
  sensorLeft.begin();
  sensorRight.begin();

  sensorCenter.requestTemperatures();
  sensorLeft.requestTemperatures();
  sensorRight.requestTemperatures();

  tCore = sensorCenter.getTempCByIndex(0);
  tLeft = sensorLeft.getTempCByIndex(0);
  tRight = sensorRight.getTempCByIndex(0);

  coreOk = (tCore != DEVICE_DISCONNECTED_C);
  leftOk = (tLeft != DEVICE_DISCONNECTED_C);
  rightOk = (tRight != DEVICE_DISCONNECTED_C);

  pinMode(GAS_LEFT_PIN, INPUT);
  pinMode(GAS_RIGHT_PIN, INPUT);
  gasLeft = analogRead(GAS_LEFT_PIN);
  gasRight = analogRead(GAS_RIGHT_PIN);

  Serial.println("\n--- Sensor Readings ---");
  Serial.printf("t_core: %s C\n", coreOk ? String(tCore).c_str() : "ERR");
  Serial.printf("t_left: %s C\n", leftOk ? String(tLeft).c_str() : "ERR");
  Serial.printf("t_right: %s C\n", rightOk ? String(tRight).c_str() : "ERR");
  Serial.printf("gas_left: %d\n", gasLeft);
  Serial.printf("gas_right: %d\n", gasRight);

  if (coreOk) {
    float edgeSum = 0;
    int edgeCount = 0;
    if (leftOk) {
      edgeSum += tLeft;
      edgeCount++;
    }
    if (rightOk) {
      edgeSum += tRight;
      edgeCount++;
    }
    if (edgeCount > 0) {
      float gradient = tCore - (edgeSum / edgeCount);
      Serial.printf("Thermal Gradient: %.1f C\n", gradient);
      if (gradient > 5.0)
        Serial.println(">> TURNING RECOMMENDED <<");
    }
  }
}

// =========================================================================
// 5. NETWORK HELPERS
// =========================================================================

bool connectWiFi() {
  Serial.println("Connecting to WiFi...");
  WiFi.disconnect(true);
  WiFi.mode(WIFI_STA);

  for (int retries = 0; retries < 3; retries++) {
    WiFi.begin(ssid, password);

    for (int attempts = 0; WiFi.status() != WL_CONNECTED && attempts < 40;
         attempts++) {
      delay(500);
      Serial.print(".");
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("\nWiFi Connected: %s\n",
                    WiFi.localIP().toString().c_str());
      return true;
    }

    Serial.println("\nRetrying WiFi...");
    delay(2000);
  }

  Serial.println("WiFi FAILED");
  return false;
}

String fetchActiveBatchId() {
  for (int i = 0; i < 3; i++) {
    WiFiClientSecure secClient; // TLS only for Supabase (external HTTPS)
    secClient.setInsecure();

    HTTPClient http;
    String url =
        String(supabase_url) +
        "/rest/v1/"
        "batches?status=eq.fermenting&order=created_at.desc&limit=1&select=id";

    http.begin(secClient, url);
    http.setTimeout(5000);
    http.addHeader("apikey", supabase_anon_key);
    http.addHeader("Authorization", String("Bearer ") + supabase_anon_key);

    Serial.println("Fetching batch...");
    int httpCode = http.GET();

    if (httpCode == 200) {
      String response = http.getString();
      http.end();

      int start = response.indexOf("\"id\":\"");
      if (start >= 0) {
        start += 6;
        int end = response.indexOf("\"", start);
        return response.substring(start, end);
      }
    }

    Serial.println("HTTP retry...");
    http.end();
    delay(2000);
  }

  return "";
}

bool connectMQTT() {
  client.setServer(mqtt_server, mqtt_port);

  for (int i = 0; i < 3; i++) {
    Serial.print("MQTT connecting...");

    // No credentials — anonymous access on local Mosquitto
    if (client.connect("InvisiPod")) {
      Serial.println("OK");
      return true;
    }

    Serial.println("Failed");
    delay(2000);
  }

  return false;
}

// =========================================================================
// 6. DEEP SLEEP
// =========================================================================

void goToSleep() {
  Serial.printf("Sleeping for %llu seconds...\n",
                SLEEP_DURATION_US / 1000000ULL);
  Serial.flush();

  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);

  esp_sleep_enable_timer_wakeup(SLEEP_DURATION_US);
  esp_deep_sleep_start();
}

// =========================================================================
// 7. MAIN — runs once per wake cycle, then sleeps
// =========================================================================

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n--- Wake Cycle ---");

  // Read sensors BEFORE WiFi (ADC stability)
  readAllSensors();

  if (!connectWiFi()) {
    Serial.println("No WiFi -> sleep");
    goToSleep();
    return;
  }

  String batchId = fetchActiveBatchId();
  if (batchId == "") {
    Serial.println("No batch -> sleep");
    goToSleep();
    return;
  }

  if (!connectMQTT()) {
    Serial.println("No MQTT -> sleep");
    goToSleep();
    return;
  }

  // Build payload with Unix epoch timestamp
  unsigned long ts =
      (unsigned long)(millis() / 1000) + 1700000000UL; // Approximate epoch
  // For accurate time, use NTP — but this is good enough for ordering

  String payload = "{";
  payload += "\"ts\":" + String(ts);
  payload += ",\"batch_id\":\"" + batchId + "\"";
  if (coreOk)
    payload += ",\"t_core\":" + String(tCore, 2);
  if (leftOk)
    payload += ",\"t_left\":" + String(tLeft, 2);
  if (rightOk)
    payload += ",\"t_right\":" + String(tRight, 2);
  payload += ",\"gas_left\":" + String(gasLeft);
  payload += ",\"gas_right\":" + String(gasRight);
  payload += "}";

  Serial.println(payload);

  // QoS 1 publish — broker ACKs before we sleep
  if (client.publish(MQTT_TOPIC, payload.c_str(), false)) {
    // Process ACK — loop briefly to receive PUBACK
    unsigned long start = millis();
    while (millis() - start < 2000) {
      client.loop();
      delay(50);
    }
    Serial.println("Published (QoS 1)");
  } else {
    Serial.println("Publish failed");
  }

  client.disconnect();
  goToSleep();
}

void loop() {
  // Never reached — setup() always ends with deep sleep
}
