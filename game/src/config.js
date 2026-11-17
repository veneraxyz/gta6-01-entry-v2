// Neon Harbor II — shared constants and tuning.
export const CFG = {
  // City: 7x7 road grid, roads at multiples of ROAD_SPACING.
  ROAD_SPACING: 60,
  ROAD_COUNT: 7,
  ROAD_WIDTH: 12,
  ROAD_HALF: 6,
  LANE_OFFSET: 3, // right-hand lane offset from road centre
  BLOCK: 48, // block size between roads
  CITY_HALF: 210, // ground extends a little past the outer roads
  GROUND_SIZE: 480,

  // Player
  WALK_SPEED: 7,
  SPRINT_SPEED: 12,
  CAR_TOP_SPEED: 34,
  CAR_ACCEL: 22,
  CAR_BRAKE: 34,
  CAR_TURN: 1.9,
  ENTER_RANGE: 5,

  // Wanted
  WANTED_DECAY_SECONDS: 18,
  ARREST_SECONDS: 1.2,
  BUST_FINE: 250,

  // Traffic
  TRAFFIC_COUNT: 14,
  TRAFFIC_SPEED: 9,
  TRAFFIC_MIN_GAP: 7,

  // Police
  POLICE_SPEED: 26,
  RAM_RANGE: 9,

  // Peds
  PED_COUNT: 24,
  PED_WALK: 1.6,
  PED_FLEE: 5.5,

  // Missions
  MISSION_COUNT: 6,

  // Colours (sunset palette)
  SKY_TOP: 0x2a1b4d,
  SKY_BOTTOM: 0xff8c42,
  FOG_COLOR: 0x3a2b55,
  SUN_COLOR: 0xffb347,
  SUN_INTENSITY: 1.35,
  HEMI_SKY: 0x8a7bd8,
  HEMI_GROUND: 0x3a2f2f,
  HEMI_INTENSITY: 0.85,
};
