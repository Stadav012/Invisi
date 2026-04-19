/*
  Invisi Conveyor — Serial slave mode
  Commands from the Pi over USB serial:
    'N' = nudge — short pulse at full duty, then auto-stop (for scanning)
    'F' = run forward continuously
    'S' = stop belt
    'C' = clearance pulse — push bean past sort gate, then auto-stop
*/

#define RPWM 5
#define LPWM 6
#define REN  8
#define LEN  9

const int duty = 67;

// How far the belt moves per nudge (scanning step). Start at 150ms; increase if
// beans aren't entering the frame, decrease if they're overshooting.
const int nudgeMs = 150;

// How long to run the belt after sorting to push the bean from the camera position
// past the sort gate. Set this to cover your camera-to-gate distance.
// Formula: (camera_to_gate_cm / belt_speed_cm_per_s) * 1000 + margin.
// At current duty with ~9cm gap, 900ms is a good starting point.
const int clearancePulseMs = 900;

void setup() {
  Serial.begin(115200);
  pinMode(RPWM, OUTPUT);
  pinMode(LPWM, OUTPUT);
  pinMode(LEN,  OUTPUT);
  pinMode(REN,  OUTPUT);
  digitalWrite(REN, HIGH);
  digitalWrite(LEN, HIGH);

  analogWrite(RPWM, 0);
  analogWrite(LPWM, 0);
  Serial.println("READY");
}

void loop() {
  if (!Serial.available()) return;

  char cmd = Serial.read();

  switch (cmd) {
    case 'N':
      analogWrite(RPWM, duty);
      analogWrite(LPWM, 0);
      delay(nudgeMs);
      analogWrite(RPWM, 0);
      analogWrite(LPWM, 0);
      Serial.println("OK");
      break;

    case 'F':
      analogWrite(RPWM, duty);
      analogWrite(LPWM, 0);
      Serial.println("OK");
      break;

    case 'S':
      analogWrite(RPWM, 0);
      analogWrite(LPWM, 0);
      Serial.println("OK");
      break;

    case 'C':
      analogWrite(RPWM, duty);
      analogWrite(LPWM, 0);
      delay(clearancePulseMs);
      analogWrite(RPWM, 0);
      analogWrite(LPWM, 0);
      Serial.println("OK");
      break;
  }
}
