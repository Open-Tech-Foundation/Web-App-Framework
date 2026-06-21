// Plain module state shared between the demo page and the <Bomb> component, so the
// page can "defuse" the bomb and a boundary reset() can then render it cleanly.
export const bomb = { armed: true };
