import { Input } from "./types.ts";

// Ping rate and the range geometry that the message only carries implicitly.
// Module state is per script instance, and the player runs two (frame + range),
// so treat the rate as an estimate rather than an exact count.
let lastStamp: number | undefined = undefined;

type PingStats = {
  ping_rate_hz: number;
  ping_interval_ms: number;
  range_bin_m: number;
  range_min_m: number;
  range_max_m: number;
  beam_count: number;
  samples_per_beam: number;
  image_bytes: number;
  sound_speed_ms: number;
  frequency_khz: number;
};

export const inputs = ["/rhody/perception/sensors/gemini/raw_sonar_image"];
export const output = "/foxglove_script/gemini_ping_stats";

export default function script(
  event: Input<"/rhody/perception/sensors/gemini/raw_sonar_image">,
): PingStats | undefined {
  const msg = event.message;
  const st: any = msg.header.stamp;
  const nsec = st.nsec !== undefined ? st.nsec : st.nanosec;
  const now = st.sec + nsec * 1e-9;

  const prev = lastStamp;
  lastStamp = now;
  if (prev === undefined) {
    return; // no interval to report on the first ping
  }

  const dt = now - prev;
  if (!isFinite(dt) || dt <= 0) {
    return;
  }

  const dr = msg.ping_info.sound_speed / (2 * msg.sample_rate);
  const binSize = isFinite(dr) && dr > 0 ? dr : 0;

  return {
    ping_rate_hz: 1 / dt,
    ping_interval_ms: dt * 1000,
    range_bin_m: binSize,
    range_min_m: msg.sample0 * binSize,
    range_max_m: (msg.sample0 + msg.samples_per_beam) * binSize,
    beam_count: msg.image.beam_count,
    samples_per_beam: msg.samples_per_beam,
    image_bytes: msg.image.data.length,
    sound_speed_ms: msg.ping_info.sound_speed,
    frequency_khz: msg.ping_info.frequency / 1000,
  };
}
