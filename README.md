# Invisi

**Invisi** is an end-to-end smart cocoa bean processing platform that spans the full post-harvest lifecycle — from fermentation monitoring through drying, optical quality sorting, and traceability. The system combines IoT sensor pods, an edge-first data pipeline, a real-time web dashboard, and a computer vision model trained to classify bean quality at the sorting stage.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Hardware — IoT Sensor Pods](#hardware--iot-sensor-pods)
4. [Edge Infrastructure](#edge-infrastructure)
5. [Telemetry Pipeline](#telemetry-pipeline)
6. [Web Portal & Dashboard](#web-portal--dashboard)
7. [Model Training & Research](#model-training--research)
   - [Dataset](#dataset)
   - [Image Preprocessing Pipeline](#image-preprocessing-pipeline)
   - [Training & Model Selection](#training--model-selection)
   - [Quantization & Edge Deployment](#quantization--edge-deployment)
8. [Optical Sorter](#optical-sorter)
9. [Batch Lifecycle](#batch-lifecycle)
10. [Deployment](#deployment)
11. [Repository Structure](#repository-structure)

---

## System Overview

A typical cocoa bean harvest goes through four critical stages after picking:

1. **Fermentation** — Beans are placed in a fermentation box for 4–7 days. Temperature gradients and gas levels indicate fermentation health.
2. **Drying** — Fermented beans are sun-dried until target moisture is reached.
3. **Sorting** — Dried beans are optically inspected and sorted into *good* vs *poor* quality.
4. **Ready / Completed** — Sorted beans are packaged and traceable for market.

Invisi automates monitoring and quality control across all four stages.

---

## Architecture

```
                          ┌─────────────────────┐
                          │   Supabase (Postgres)│
                          │   • batches          │
                          │   • sensor_readings   │
                          │   • fermentation_events│
                          │   • farmer auth       │
                          └──────────┬────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
    ┌─────────▼──────────┐  ┌───────▼────────┐  ┌──────────▼──────────┐
    │  ESP32 Sensor Pod  │  │ Telemetry Worker│  │  Next.js Dashboard  │
    │  (invisi_pod.ino)  │  │ bridge.ts       │  │  (Vercel)           │
    │                    │  │ consumer.ts     │  │  • Dashboard        │
    │  DS18B20 × 3       │──│                 │──│  • Monitor          │
    │  MQ-135  × 2       │  │ MQTT → Redis →  │  │  • Batch Manager    │
    │                    │  │ Supabase        │  │  • Traceability     │
    └────────────────────┘  └─────────────────┘  └─────────────────────┘
                                                          │
                                                 ┌────────▼────────┐
                                                 │ Optical Sorter  │
                                                 │ (Raspberry Pi)  │
                                                 │ ResNet50 INT8   │
                                                 │ + Servo Gate    │
                                                 │ → Redis buffer  │
                                                 └─────────────────┘
```

---

## Hardware — IoT Sensor Pods

**Directory:** `esp32/invisi_pod/`

The physical monitoring unit runs on an ESP32 microcontroller.

| Component | Role |
|---|---|
| 3× Dallas DS18B20 | Core temperature + left/right edge temperatures (thermal gradient) |
| 2× MQ-135 gas sensors | Volatile gas concentration inside the fermentation box |

**Firmware workflow:**

1. Wake from deep sleep every 30 minutes.
2. Connect to WiFi and query Supabase for the active fermentation batch.
3. Read all sensors — compute thermal gradient (`t_core − avg(t_left, t_right)`).
4. Publish a JSON payload via secure MQTT (HiveMQ Cloud).
5. Return to deep sleep to conserve battery.

The pod is designed to survive a full 7-day fermentation cycle on a single charge.

---

## Edge Infrastructure

**Directory:** `edge/`

Contains deployment scripts and configuration for the Raspberry Pi gateway:

| File | Purpose |
|---|---|
| `migration.sql` | Schema migration for edge-first column naming (`t_core`, `t_left`, `t_right`), the `fermentation_events` table, and an hourly rollup materialized view |
| `setup.sh` | Automated provisioning script (Node.js, Redis, Mosquitto, systemd services) |
| `mosquitto.conf` | Local MQTT broker configuration (bridge to HiveMQ) |
| `invisi-telemetry.service` | systemd unit for the telemetry worker |

---

## Telemetry Pipeline

**Directory:** `nextjs-app/telemetry/`

A decoupled, resilient data ingestion pipeline deployed as a background worker on Render.

| Module | Responsibility |
|---|---|
| `bridge.ts` | Subscribes to the MQTT broker, receives live JSON payloads from the ESP32, and queues them into an Upstash Redis Stream |
| `consumer.ts` | Polls the Redis Stream in a consumer group, parses readings, and persists them into the `sensor_readings` table in Supabase |
| `index.ts` | Entry point — runs both bridge and consumer with health-check endpoints |

**Key properties:**
- At-least-once delivery via Redis consumer groups.
- No data loss during database downtime — readings stay queued in Redis.
- Edge-first: the Pi can buffer data locally in Redis if the internet drops.

---

## Web Portal & Dashboard

**Directory:** `nextjs-app/`

A Next.js 15 progressive web app deployed on Vercel, serving as the farmer's command center.

### Pages

| Route | Feature |
|---|---|
| `/` (Dashboard) | Overview cards for each active batch — status, fermentation day, latest sensor snapshot (temps, gas, gradient) |
| `/monitor` | Full telemetry history with paginated table, real-time sensor strip (polls every 10s independently of pagination), thermal charts via Recharts |
| `/market` (Batches) | Full lifecycle manager — filter by status, transition batches through `fermenting → drying → sorting → ready → completed` |
| `/traceability` | Batch provenance and quality reports |

### Key Components

| Component | Description |
|---|---|
| `PodView.tsx` | Interactive 3D fermentation pod visualizer (React Three Fiber) — color maps to batch status |
| `ThermalChart.tsx` | Time-series temperature curves (core, left, right edge) |
| `TurnAlert.tsx` | Rule-based alert when thermal gradient exceeds threshold — prompts farmer to turn the beans |
| `BatchCard.tsx` | Status-aware card with animated transitions (Framer Motion) for all 5 lifecycle states |
| `BottomNav.tsx` | Mobile-first bottom navigation — Dashboard, Monitor, Batches, Traceability |

### Stack
- **Framework:** Next.js 15 (App Router, SSR)
- **Styling:** Tailwind CSS
- **Animations:** Framer Motion
- **Charts:** Recharts
- **3D:** React Three Fiber + Drei
- **Auth:** Supabase Auth (farmer-scoped, multi-tenant)
- **Database:** Supabase (PostgreSQL)

---

## Model Training & Research

**Directory:** `model-training/`

This section documents the full machine learning pipeline — from raw data through model selection, evaluation, and edge deployment.

### Dataset

The training data is composed of two sources:

#### 1. Indonesian Research Dataset — `CocoaBeansQCV/`

Sourced from research conducted at **Universitas Al Asyariah Mandar** and **Universitas Hasanuddin Fakultas Teknik** (Indonesia). This dataset contains **458 images per class** (good and poor quality) of cross-sectional cocoa bean images.

The raw images go through an 8-stage preprocessing pipeline, each stage preserved in its own subfolder:

| Stage | Folder | Description |
|---|---|---|
| 1 | `1. Raw Extracted Cocoa Beans Image/` | Original photographs — 458 poor (`Bj_Buruk`) + 458 good (`Bj_Baik`) |
| 2 | `2. Resize Image 960x540 px/` | Standardized resolution |
| 3 | `3. Sharpening Image/` | Edge enhancement for feature visibility |
| 4 | `4. Convert Image RGB2HSV/` | Color space conversion for masking |
| 5 | `5. Masking Image/` | Background isolation via HSV thresholding |
| 6 | `6. Merge Image Masking/` | Combined mask overlay on original |
| 7 | `7. Bounding Box Object Image/` | Bean localization via contour detection |
| 8 | `8. Cropping Object Image/` | Final cropped bean images — input to classification models |

#### 2. Invisi Field Augmentation

After fermentation and drying on-site, we captured an additional **400 images** (380 good, 20 poor quality beans) from our own processing pipeline. These were augmented into the training set to improve model generalization on post-fermented beans specific to our production environment.

**Combined totals:** ~1,316 images across both classes.

---

### Training & Model Selection

**Notebook:** `Invisi_models_training.ipynb`

The notebook documents a systematic model evaluation conducted on an **NVIDIA A100-SXM4-40GB GPU** (CUDA 13.1). The following models were trained, compared, and analyzed:

#### Models Evaluated

| # | Model | Architecture | Key Observations |
|---|---|---|---|
| 1 | **YOLOv8-cls (Nano)** | Object detection backbone | Overfitting after epoch 25; heavily biased toward majority class due to data skew |
| 2 | **YOLOv8-cls (Medium)** | Larger YOLO variant | Same bias issue — the model treats the entire defective region as one "object" rather than learning fine-grained texture |
| 3 | **MobileNetV3-Large** | Lightweight CNN (Google) | Trained on cropped data with 224×224 input. Broad feature activation — Grad-CAM shows red blocks that are faint and spill across healthy tissue |
| 4 | **ResNet50** ✅ | Deep residual network (50 layers) | Industry-standard baseline with skip connections. Best balance of accuracy and edge performance. Clear, localized feature activation on defect regions |
| 5 | **ViT (vit_base_patch16_224)** | Vision Transformer | Extremely precise spatial attention — draws tight digital boxes around defects. Highest accuracy but too large for edge inference |
| 6 | **ConvNeXt** | Modernized CNN (Meta AI) | Transformer-like upgrades (7×7 depthwise convolutions, layer normalization). Excels at detecting tiny cracks and subtle texture variations |

#### Training Iterations (Chronological)

The notebook captures the full iterative process:

1. **Training 1 — YOLOv8 Nano, original data:** Overfitting detected after epoch 25 (train/val loss divergence).
2. **Training 2 — YOLOv8 Nano, 25 epochs:** Reduced epochs based on findings. Model still biased toward `sana` (good) class.
3. **Training 3 — YOLOv8 Nano, weighted loss:** Attempted class weight adjustment. Confusion matrix stagnant — model ignores weights.
4. **Training 4 — YOLOv8 Medium:** Upgraded model capacity. Still unable to learn `mala` (poor) features due to data skew.
5. **Training 5 — Stratified oversampling:** Balanced dataset via oversampling. Marginal improvement — suspected feature overlap between classes.
6. **Training 6 — Cropped data, balanced:** Used preprocessed cropped images from stage 8. 75–80% error rate on poor beans persists — confirmed **Feature Overlap** phenomenon.
7. **Image analysis:** Visual EDA confirmed the original dataset classes are visually too similar for the YOLO architecture to discriminate.
8. **New dataset + multiple architectures:** Switched to combined dataset with field augmentation. Trained MobileNetV3, ResNet50, ViT, and ConvNeXt. *"Amazing results finally — this proves the data I was using was really not showing the best difference."*

#### Evaluation Techniques

- **Grad-CAM:** Visualized activation heatmaps for each model to understand where they "look" when classifying.
- **SHAP (SHapley Additive Explanations):** Feature importance analysis across all four architectures.
- **t-SNE:** Dimensionality reduction visualization to verify class separability in learned feature space.
- **Inference speed benchmarking:** Measured per-image latency on both GPU and target edge hardware (Raspberry Pi).

#### Final Model Selection: **ResNet50**

ResNet50 was selected as the production model because it offers the best trade-off:
- **Accuracy:** Strong defect localization — skip connections allow deep feature learning without vanishing gradients.
- **Edge viability:** After INT8 quantization, inference runs efficiently on Raspberry Pi CPU via ONNX Runtime.
- **Interpretability:** Clean Grad-CAM activations — the model focuses precisely on defect regions, not background noise.

---

### Quantization & Edge Deployment

The final ResNet50 model is exported and quantized for edge deployment:

1. **Export to ONNX** — Framework-agnostic inference format.
2. **INT8 Quantization** — Reduces model size and inference latency by ~4× with minimal accuracy loss.
3. **Deployed as:** `Trained_ResNet50_INT8.onnx` on the Raspberry Pi.
4. **Runtime:** ONNX Runtime with `CPUExecutionProvider`, throttled to 2 threads to prevent power brownouts on the Pi.

---

## Optical Sorter

**Directory:** `sorter/`

The sorting machine runs on a Raspberry Pi with a PiCamera and a servo-actuated gate.

### Hardware

| Component | Role |
|---|---|
| Raspberry Pi | Compute — runs ONNX Runtime |
| PiCamera v2 | Captures live video feed at 640×480 |
| Angular Servo (GPIO 18) | Physical sorting gate — swings ±45° to route beans |

### Software Pipeline (`sorter.py`)

```
Camera Frame → Extract Bean → Preprocess → ResNet50 INT8 → Classify → Actuate Gate
     │                                                            │
     └────────── Log result to Redis ◄────────────────────────────┘
```

1. **Bean extraction:** Grayscale → Gaussian blur → Otsu thresholding → contour detection → crop largest contour with 15px padding.
2. **Preprocessing:** Resize to 224×224, normalize with ImageNet mean/std, transpose to NCHW format.
3. **Inference:** ONNX Runtime runs the quantized ResNet50 — returns probabilities for `[POOR, GOOD]`.
4. **Actuation:** Servo swings to −45° (poor) or +45° (good), then returns to neutral.
5. **Logging:** Each classification is buffered in a Redis sorted set (`{pod_id}_sorting`) with timestamp, prediction, confidence, and inference latency. A 72-hour TTL prunes stale entries.
6. **Batch association:** On startup, the sorter queries Supabase for the active batch ID and tags all results accordingly.

### Offline Resilience

Results are buffered in Redis and can be synced to Supabase when connectivity is restored — the same edge-first pattern used by the telemetry pipeline.

---

## Batch Lifecycle

Each cocoa batch progresses through a 5-stage lifecycle managed via the web dashboard:

```
fermenting → drying → sorting → ready → completed
```

| Status | Description |
|---|---|
| `fermenting` | Active fermentation — pod is collecting sensor data every 30 min |
| `drying` | Beans removed from fermentation box, being sun-dried |
| `sorting` | Dried beans are passing through the optical sorter |
| `ready` | Sorting complete — beans are graded and packaged |
| `completed` | Batch archived — full traceability record available |

Transitions are enforced in sequence. The database enforces valid states via a CHECK constraint on the `batches.status` column.

---

## Deployment

| Component | Platform | Notes |
|---|---|---|
| Web Dashboard | Vercel | Next.js 15 SSR |
| Telemetry Worker | Render | Background worker via `render.yaml` |
| Database | Supabase | PostgreSQL + Auth + Row-Level Security |
| MQTT Broker | HiveMQ Cloud | TLS-secured, bridged to local Mosquitto |
| Stream / Queue | Upstash | Redis Streams for at-least-once delivery |
| Edge Gateway | Raspberry Pi | Local Redis, Mosquitto, telemetry worker, optical sorter |

---

## Repository Structure

```
Invisi/
├── AGENTS.md                           # Agent operating instructions (mirrored guidance)
├── STYLE.md                            # Project code style guide
├── README.md                           # Project documentation
├── edge/
│   ├── migration.sql                   # Supabase schema migration (edge-first naming)
│   ├── setup.sh                        # Pi provisioning (Node, Redis, Mosquitto, systemd)
│   ├── mosquitto.conf                  # Local MQTT broker config
│   └── invisi-telemetry.service        # systemd unit for telemetry worker
│
├── esp32/
│   └── invisi_pod/
│       └── invisi_pod.ino              # ESP32 firmware — sensors, MQTT, deep sleep
│
├── model-training/
│   ├── Invisi_models_training.ipynb    # Full training notebook — 6 models, Grad-CAM,
│   │                                   # SHAP, t-SNE, quantization, edge benchmarks
│   └── CocoaBeansQCV/                  # Indonesian research dataset (916 images)
│       ├── 1. Raw Extracted Cocoa Beans Image/
│       │   ├── 1.0-Poor Quality Beans_Raw/   (458 images)
│       │   └── 1.1-Good Quality Beans_Raw/   (458 images)
│       ├── 2. Resize Image 960x540 px/
│       ├── 3. Sharpening Image/
│       ├── 4. Convert Image RGB2HSV/
│       ├── 5. Masking Image/
│       ├── 6. Merge Image Masking/
│       ├── 7. Bounding Box Object Image/
│       └── 8. Cropping Object Image/         (final preprocessed beans)
│
├── nextjs-app/
│   ├── app/                            # App Router pages, server actions, route handlers
│   │   ├── page.tsx                    # Dashboard home
│   │   ├── monitor/page.tsx            # Live telemetry + historical monitoring
│   │   ├── market/page.tsx             # Batch lifecycle management
│   │   ├── profile/page.tsx            # Profile/system status
│   │   ├── login/page.tsx              # Login/signup UI
│   │   ├── login/actions.ts            # Server actions for auth
│   │   ├── auth/
│   │   │   ├── confirm/route.ts        # Email confirmation callback
│   │   │   └── signout/route.ts        # Logout route handler
│   │   └── api/
│   │       ├── batches/route.ts        # List/create batches
│   │       ├── batches/[id]/route.ts   # Update/delete a single batch
│   │       ├── readings/route.ts       # Sensor readings API
│   │       ├── readings/hourly/route.ts# Hourly rollup API
│   │       └── sorting/route.ts        # Sorter output API
│   ├── components/                     # Reusable UI and visualization components
│   │   ├── Header.tsx
│   │   ├── BottomNav.tsx
│   │   ├── PodView.tsx
│   │   ├── ThermalChart.tsx
│   │   ├── TurnAlert.tsx
│   │   ├── BatchCard.tsx
│   │   ├── NewBatchModal.tsx
│   │   ├── SortingStats.tsx
│   │   └── StatsCard.tsx
│   ├── lib/supabase/                   # Supabase clients + middleware integration
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── middleware.ts
│   ├── telemetry/
│   │   ├── bridge.ts                   # MQTT → Redis Stream
│   │   ├── consumer.ts                 # Redis Stream → Supabase
│   │   ├── index.ts                    # Worker entry point + health checks
│   │   ├── logging.ts                  # Structured worker logging utilities
│   │   ├── simulator.ts                # Telemetry simulation helper
│   │   └── test-redis.ts               # Redis connectivity test script
│   ├── public/                         # Static assets and icons
│   ├── app/globals.css                 # Global styling
│   ├── app/layout.tsx                  # Root layout
│   ├── proxy.ts                        # Session/update middleware proxy
│   ├── next.config.ts                  # Next.js configuration
│   ├── eslint.config.mjs               # Linting config
│   ├── postcss.config.mjs              # PostCSS/Tailwind plumbing
│   ├── tsconfig.json                   # TypeScript config
│   ├── package.json                    # Web app dependencies/scripts
│   ├── package-lock.json               # npm lockfile
│   ├── bun.lock                        # bun lockfile
│   ├── README.md                       # App-specific setup notes
│   └── render.yaml                     # Render deployment config for telemetry worker
│
└── sorter/
    ├── sorter.py                       # Optical sorting runtime (camera, ONNX, servo, Redis)
    ├── requirements.txt                # Python dependencies for sorter runtime
    └── conveyor/
        └── conveyor.ino                # Conveyor controller firmware (microcontroller)
```

---

## License

This project is developed as part of academic research and capstone work. See individual component licenses for third-party dependencies.
