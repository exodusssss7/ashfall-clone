import { clamp } from './isometric';

const DRIVING_AXIS_DEADZONE = 0.16;

// The stick is a throttle/steering control, never a target screen heading.
// Independent deadzones let the driver hold straight ahead without tiny turns.
export function vehicleRelativeTouchInput(x: number, y: number): { throttle: number; steer: number } {
  const axis = (value: number) => {
    const bounded = clamp(value, -1, 1);
    return Math.abs(bounded) <= DRIVING_AXIS_DEADZONE
      ? 0
      : Math.sign(bounded) * (Math.abs(bounded) - DRIVING_AXIS_DEADZONE) / (1 - DRIVING_AXIS_DEADZONE);
  };
  return { throttle: axis(-y), steer: axis(x) };
}
