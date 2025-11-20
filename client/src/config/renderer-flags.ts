// ============================================
// Renderer Mode Configuration
// ============================================

export type RendererMode = 'phaser-only' | 'three-only';

export interface RendererFlags {
  mode: RendererMode;
  showDebugOverlay: boolean;
  captureBaseline: boolean;
}

/**
 * Get renderer mode from URL params or localStorage
 * Priority: URL params > localStorage > default
 */
export function getRendererFlags(): RendererFlags {
  const params = new URLSearchParams(window.location.search);
  const stored = localStorage.getItem('renderer-mode');

  const mode = (params.get('renderer') || stored || 'phaser-only') as RendererMode;
  const showDebugOverlay = params.has('debug') || localStorage.getItem('debug-overlay') === 'true';
  const captureBaseline = params.has('baseline');

  // Persist to localStorage
  localStorage.setItem('renderer-mode', mode);
  if (showDebugOverlay) {
    localStorage.setItem('debug-overlay', 'true');
  }

  return { mode, showDebugOverlay, captureBaseline };
}

/**
 * Set renderer mode and reload
 */
export function setRendererMode(mode: RendererMode): void {
  localStorage.setItem('renderer-mode', mode);
  window.location.reload();
}
