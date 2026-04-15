/*
  Invisi Conveyor — Serial slave mode
  Listens for single-char commands from the Pi over USB serial:
    'F' = run belt forward
    'S' = stop belt
    'C' = short clearance pulse (push bean past gate, then auto-stop)

  Responds with 'OK\n' after executing each command.
  The Pi decides when to stop/start based on camera vision.
*/

#define RPWM 5
#define LPWM 6
#define REN  8
#define LEN  9

const int dutyCycle = 60;
const int clearancePulseMs = 1600;  // time to push bean past the gate

void runMotor() {
  analogWrite(RPWM, dutyCycle);
  analogWrite(LPWM, 0);
}

void stopMotor() {
  analogWrite(RPWM, 0);
  analogWrite(LPWM, 0);
}

void setup() {
  Serial.begin(9600);
  pinMode(RPWM, OUTPUT);
  pinMode(LPWM, OUTPUT);
  pinMode(LEN,  OUTPUT);
  pinMode(REN,  OUTPUT);
  digitalWrite(REN, HIGH);
  digitalWrite(LEN, HIGH);

  stopMotor();
  Serial.println("READY");
}

void loop() {
  if (!Serial.available()) return;

  char cmd = Serial.read();

  switch (cmd) {
    case 'F':
      runMotor();
      Serial.println("OK");
      break;

    case 'S':
      stopMotor();
      Serial.println("OK");
      break;

    case 'C':
      runMotor();
      delay(clearancePulseMs);
      stopMotor();
      Serial.println("OK");
      break;
  }
}
