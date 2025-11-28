// ============================================
// Ability Components
// Marker components that grant abilities to entities.
// Added/removed when entities evolve.
// ============================================

// Note: These are "marker" components - they have no data,
// but their presence/absence on an entity determines capabilities.
// Systems check for these components to allow/disallow actions.

/**
 * CanFireEMP - entity can use EMP pulse ability.
 * Granted at: Stage 2 (Multi-cell) and above
 * Effect: Stuns nearby swarms and players, drains energy
 */
export interface CanFireEMPComponent {
  // Marker component - presence enables EMP ability
  // Cooldown tracked in CooldownsComponent
}

/**
 * CanFirePseudopod - entity can fire pseudopod beam.
 * Granted at: Stage 2 (Multi-cell) and above
 * Effect: Long-range energy drain projectile
 */
export interface CanFirePseudopodComponent {
  // Marker component - presence enables pseudopod ability
  // Cooldown tracked in CooldownsComponent
}

/**
 * CanSprint - entity can use sprint speed boost.
 * Granted at: Stage 3 (Cyber-organism) and above
 * Effect: Increased speed at energy cost
 */
export interface CanSprintComponent {
  // Marker component - presence enables sprint ability
  // Active state tracked in SprintComponent
}

/**
 * CanEngulf - entity can drain smaller entities on contact.
 * Granted at: Stage 2 (Multi-cell) and above
 * Effect: Contact with smaller stage entities drains their energy
 */
export interface CanEngulfComponent {
  // Marker component - presence enables contact predation
}

/**
 * CanDetect - entity has chemical sensing (radar).
 * Granted at: Stage 2 (Multi-cell) and above
 * Effect: Can see entities within detection radius
 */
export interface CanDetectComponent {
  radius: number; // Detection range in pixels
}
