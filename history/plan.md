Step 6: Client - Death System

     File: client/src/scenes/GameScene.ts

     - Implement createDilutionEffect(position, color):
       - Create 20-30 particles at death position
       - Particles slowly drift apart and fade over 2 seconds
       - Use Phaser particle emitter or manual Graphics circles
     - Add network handlers:
       - playerDied: trigger dilution effect, remove cyber-cell sprite
       - playerRespawned: create new cyber-cell at respawn position
       - energyUpdate: update UI bars

     Step 7: Testing & Polish

     - Test nutrient collection: verify collision detection, respawn timing
     - Test energy decay: verify 90 seconds to starvation at single-cell stage
     - Test death: verify permanent loss (stats reset), dilution effect plays
     - Test multiplayer: 2+ clients collecting nutrients, competing for resources
     - Add visual polish: collection particle effects, energy bar glow/pulse
     - Add console logs for debugging (remove before merge)

     Files Modified

     1. shared/index.ts - types and constants
     2. server/src/index.ts - game loop, collision, metabolism, death
     3. client/src/scenes/GameScene.ts - rendering, UI, effects

     Testing Checklist

     - Nutrients spawn on server start (25 total)
     - Nutrients visible to all clients
     - Collection works (touch nutrient → gain energy)
     - Nutrients respawn after 30 seconds
     - Energy decays over time (90 sec to empty)
     - Health decreases when energy is empty
     - Death triggers at 0 health
     - Death shows dilution effect (particles scatter)
     - Player respawns at random location with reset stats
     - Multiple players can collect different nutrients
     - UI bars update smoothly

     Commit Strategy

     One commit after all systems working: "Implement nutrient collection and
     metabolism systems"
