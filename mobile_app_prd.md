# moxxy Mobile App: Product Requirements Document (PRD)

## 1. Overview & Core Vision
The moxxy Mobile App serves as the physical sensory extension and omnipresent companion client for the self-hosted moxxy Swarm architecture. 
Unlike standard AI chatbot wrappers, this application transforms the mobile device into a high-frequency telemetry node, allowing the AI agent to proactively monitor the user's physical environment and initiate asynchronous actions (e.g., booking an Uber when detecting rain via GPS + Weather, or texting contacts when heart rate spikes during a drive).

## 2. Target Platforms
- **Primary:** iOS Native (SwiftUI) to leverage deep HealthKit & Secure Enclave integration.
- **Secondary:** Android Native (Kotlin/Jetpack Compose) for background geofencing and sensor APIs.

## 3. System Architecture & Authentication

### 3.1 Self-Hosted Topology
The application connects directly to a user's self-hosted moxxy Daemon (running on a cloud VPS or home server) via a provided URL (`host` parameter). There is no centralized intermediary server.

### 3.2 Symmetric Device Pairing
OAuth is considered too heavy for a single-tenant framework. Auth resolves via a highly secure Symmetric Handshake:
1. User clicks **[Pair Device]** on the moxxy Web Dashboard.
2. The agent executes `GET /api/agents/:agent/pair_mobile`, generating a 256-bit symmetric UUID payload (`MX_MOB_XYZ...`) stored in its local vault.
3. The dashboard renders a QR Code: `moxxy://pair?host=wss://home.moxxy:3003&key=MX_MOB_XYZ...`
4. The mobile app scans this and commits the Bearer Token to its Secure Enclave.
5. All subsequent requests include header: `Authorization: Bearer <token>`.

## 4. Feature Requirements & API Endpoints 

### 4.1 Real-Time Sensory Telemetry (Background)
The most critical feature of the app is gathering background data.
**Endpoint:** `WebSocket /api/v1/mobile/telemetry`
- **Behavior:** The app establishes a persistent WSS connection. Every 60-120 seconds, it pushes a JSON batch to the sever mapping:
  - `gps_coordinates` (Lat, Lon, Speed MPH)
  - `health` (Heart Rate BPM, Step Count)
  - `battery_state`
- **Backend Sync:** The moxxy engine receives this stream, injects it into the Agent's Short-Term Memory, and evaluates emergency logic entirely server-side.

### 4.2 Interactive Copilot Chat (Foreground)
The user interface resembles a chat interface, but with deep voice support.
**Endpoint:** `POST /api/v1/mobile/chat`
- **Request Body:** JSON containing `{"prompt": "Reserve a table for 2", "audio_transcript_confidence": 0.99}`
- **Behavior:** The app can record audio, transcribe it via on-device CoreML (or send the audio chunk to a Whisper endpoint), and send the textual prompt down this pipe.
- **Response:** The endpoint synchronously awaits the Swarm's ReAct loop and responds with the agent's textual output or tool confirmations.

### 4.3 Agent "Thought Process" Streaming
To convey the immense complexity of an autonomous agent operating on the backend, the UI must visualize the agent's tool execution matrix in real-time.
**Endpoint:** `GET /api/v1/mobile/stream`
- **Behavior:** A unidirectional Server-Sent Events (SSE) stream.
- **UI Element:** 
  - When the agent is "thinking" or running `network_recon` or `execute_bash`, the app subscribes to this stream.
  - The UI presents a scrolling, hacker-style "Terminal View" overlaid on the chat, logging the agent's real-time stdout outputs directly on the phone screen.

### 4.4 Proactive Push Notifications
**Endpoint:** `GET /api/v1/mobile/notifications`
- **Behavior:** Since raw APNs (Apple Push Notification service) requires a paid developer certificate, the app should fall back on background polling this endpoint (or Websockets) to retrieve proactive thoughts initiated by the Agent.
- **Example Usage:** *"I noticed your calendar says meeting at 2:00 PM, but you are still 45 miles away. Should I dial you in via Zoom?"*

## 5. Security Constraints
- **Zero Raw Data Extraction:** Sensory context goes explicitly to the Self-Hosted memory `.db`, guaranteeing 100% data sovereignty for the user.
- **Location Spoofing Guard:** Agents trust the mobile telemetry absolutely. Validation logic should ensure timestamps are strictly monotonically increasing.
