export function minMax(
  val: number | undefined,
  min: number,
  max: number,
  defaultValue: number,
  wrap: boolean = false
) {
  if (val === undefined) {
    return defaultValue;
  }
  if (wrap) {
    const r = max - min;
    while (val < min) {
      val += r;
    }
    while (val > max) {
      val -= r;
    }
  } else {
    val = Math.max(min, Math.min(max, val));
  }
  return val;
}
