/**
 * Client-only configuration - tuning knobs for rendering, interpolation, and UI.
 * These values don't affect game logic (which lives on the server).
 */

export const CLIENT_CONFIG = {
  // ============================================
  // Network Interpolation
  // ============================================

  // How far behind server time to render (milliseconds)
  // Higher = smoother but more lag, lower = more responsive but jittery
  INTERPOLATION_DELAY_MS: 100,

  // Number of server snapshots to keep in the ring buffer
  // Must be large enough to cover jitter + interpolation delay
  INTERPOLATION_BUFFER_SIZE: 5,

  // Maximum time to extrapolate beyond last snapshot (milliseconds)
  // After this, freeze entity at last known position
  EXTRAPOLATION_MAX_MS: 200,

  // ============================================
  // Camera
  // ============================================

  // Camera position lerp factor (0-1)
  // Higher = camera follows faster, lower = smoother/floatier
  CAMERA_EASING_FACTOR: 0.1,

  // Camera zoom lerp factor (0-1)
  CAMERA_ZOOM_EASING: 0.05,

  // Zoom levels per evolution stage (affects orthographic camera size)
  CAMERA_ZOOM_SINGLE_CELL: 1.0,
  CAMERA_ZOOM_MULTI_CELL: 0.8,
  CAMERA_ZOOM_CYBER_ORGANISM: 0.6,
  CAMERA_ZOOM_HUMANOID: 0.5,
  CAMERA_ZOOM_GODCELL: 0.4,

  // ============================================
  // Rendering
  // ============================================

  // Target fixed-step simulation rate (Hz) - should match server tick rate
  SIMULATION_TICK_RATE: 60,

  // Maximum accumulated time before skipping frames (prevents spiral of death)
  MAX_FRAME_TIME_MS: 250,

  // Trail settings
  TRAIL_LIFETIME_MS: 2000,
  TRAIL_MAX_POINTS: 50,
  TRAIL_SPAWN_INTERVAL_MS: 50,

  // Particle settings (ambient flow)
  PARTICLE_UPDATE_RATE: 60, // Hz
  PARTICLE_FLOW_SPEED: 20,  // Pixels per second

  // ============================================
  // UI
  // ============================================

  // Energy update throttle (Hz) - don't update UI every frame
  ENERGY_UPDATE_RATE: 10,

  // Number format precision
  ENERGY_DECIMAL_PLACES: 0,
  HEALTH_DECIMAL_PLACES: 0,

  // ============================================
  // Debug
  // ============================================

  // Enable debug overlays
  DEBUG_SHOW_FPS: false,
  DEBUG_SHOW_HITBOXES: false,
  DEBUG_SHOW_INTERPOLATION_BUFFER: false,
  DEBUG_SHOW_NETWORK_STATS: false,
} as const;

export type ClientConfig = typeof CLIENT_CONFIG;
