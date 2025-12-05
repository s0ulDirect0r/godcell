// ============================================
// Obstacle Renderer
// Re-exports from GravityDistortionMesh.ts (single source of truth)
// Provides backward-compatible aliases for existing code
// ============================================

export {
  createGravityDistortion,
  updateGravityDistortionAnimation,
  disposeGravityDistortion,
  type AccretionParticle,
  type GravityDistortionResult,
} from '../meshes/GravityDistortionMesh';

// Backward-compatible aliases (used by ObstacleRenderSystem)
export {
  createGravityDistortion as createObstacle,
  updateGravityDistortionAnimation as updateObstacleAnimation,
  disposeGravityDistortion as disposeObstacle,
} from '../meshes/GravityDistortionMesh';
