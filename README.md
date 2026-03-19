# Invisi

Invisi is a smart cocoa bean fermentation tracking and quality analysis system. The platform consists of hardware IoT sensor pods, a real-time web dashboard for telemetry, and a machine-learning component for post-fermentation quality assessment.

## Code Architecture Tree

```text
Invisi/
├── esp32/
│   └── invisi_pod/
│       └── invisi_pod.ino        # ESP32 C++ firmware for reading sensors and publishing to MQTT
├── model-training/
│   ├── dataset.md                # Information about the cocoa bean dataset
│   └── yolov8_cocoa_classification.ipynb # YOLOv8 model training notebook for bean quality analysis
├── nextjs-app/
│   ├── app/                      # Next.js App Router (pages and API routes)
│   ├── components/               # React components (Dashboard, 3D PodView, Charts)
│   ├── lib/                      # Shared libraries (Supabase client)
│   ├── telemetry/                # Node.js worker for data ingestion pipeline
│       ├── bridge.ts             # Subscribes to MQTT & pushes to Upstash Redis Stream
│       ├── consumer.ts           # Polls Redis and writes readings to Supabase
│       ├── index.ts              # Entry point for the telemetry service with health checks
│   ├── package.json              # Web app and telemetry dependencies
│   └── render.yaml               # Deployment config for the telemetry worker on Render
└── README.md                     # This file
```

## System Components

### 1. Hardware IoT Pods (`esp32/`)
The physical hardware component runs on an ESP32 microcontroller (`invisi_pod.ino`). 
- **Sensors:** Reads from 3 Dallas DS18B20 temperature sensors (measuring core and edge temperatures to calculate thermal gradients) and 2 MQ-135 gas sensors.
- **Workflow:** Wakes up from deep sleep every 30 minutes, connects to WiFi, queries Supabase for the currently active fermentation batch, publishes the sensor readings via secure MQTT (HiveMQ), and returns to deep sleep to conserve battery.

### 2. Web Portal & Dashboard (`nextjs-app/`)
A Next.js 15 web application that serves as the command center for the fermentation process.
- **Frontend Dashboard:** Built with Tailwind CSS, Framer Motion, and Recharts. Features a dynamic 3D visualizer using React Three Fiber (`PodView.tsx`), thermal charts to track temperature curves (`ThermalChart.tsx`), and automated alerts to turn the beans if the thermal gradient becomes too high (`TurnAlert.tsx`).
- **Data Management:** Users can manage batches (fermenting, drying, ready) and view live and historical telemetry data powered by a Supabase PostgreSQL backend.

### 3. Telemetry Pipeline (`nextjs-app/telemetry/`)
A highly scalable, decoupled data ingestion pipeline deployed as a background worker.
- **Bridge:** Connects to the MQTT broker, receives the live JSON payloads from the ESP32 pods, and queues them into an Upstash Redis Stream.
- **Consumer:** Continuously polls the Redis Stream in a consumer group, parses the data, and persists the readings into the `sensor_readings` table in Supabase. Ensures no data is lost even during high load or database downtime.

### 4. Machine Learning Quality Analysis (`model-training/`)
For the final sorting phase, the project uses computer vision to evaluate bean quality.
- **Dataset:** Contains 3,268 cross-sectional images of cocoa beans from Ecuador, categorized into good ('sana') and poor ('mala') quality.
- **Model:** A YOLOv8 image classification neural network trained via Jupyter Notebook (`yolov8_cocoa_classification.ipynb`) to automate the quality validation of the final dried beans.

## Deployment

- **Frontend:** Vercel (Next.js App)
- **Telemetry Worker:** Render (configured via `render.yaml`)
- **Database:** Supabase (PostgreSQL)
- **Message Broker:** HiveMQ (MQTT)
- **Stream/Queue:** Upstash (Redis)
