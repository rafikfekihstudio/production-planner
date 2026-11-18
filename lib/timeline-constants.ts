export const SLOT_MINUTES = 15
export const SLOT_HEIGHT = 28
export const DAY_START_MIN = 7 * 60
export const DAY_END_MIN = 23 * 60
export const SLOTS = (DAY_END_MIN - DAY_START_MIN) / SLOT_MINUTES
export const TIMELINE = { SLOT_MINUTES, SLOT_HEIGHT, DAY_START_MIN, DAY_END_MIN, SLOTS }