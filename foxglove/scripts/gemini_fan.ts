import { Input } from "./types.ts";
import { PointCloud, NumericType } from "@foxglove/schemas";

// Verified against live data: the buffer is SAMPLE-major, index = sample * beam_count + beam.
// (glf_processor.cpp's "row-major (beam-major)" comment is inaccurate -- it passes the
// Gemini SDK buffer through unchanged, and the SDK packs all beams per range sample.)
const BEAM_MAJOR = false;

// REP-103 (X forward, Y left, Z up), so the fan lies flat in the XY plane and reads
// as a plan view. Set true for the driver's own ProjectedSonarImage convention
// (X up, Y right, Z forward), which puts the fan in the Y-Z plane instead.
const DRIVER_AXES = false;

// 0-255. Live distribution on this scene: median 5, p75 13, p90 53 -- 25 keeps ~16% of
// samples and still reaches the full 10 m. Raise it to thin out water-column noise.
const MIN_INTENSITY = 25;
const BEAM_STRIDE = 2;
const SAMPLE_STRIDE = 4;
const MAX_POINTS = 120000; // 1024 beams x 2048 samples is 2M points: decimate or the panel stalls

export const inputs = ["/rhody/perception/sensors/gemini/raw_sonar_image"];
export const output = "/foxglove_script/gemini_fan";

export default function script(
  event: Input<"/rhody/perception/sensors/gemini/raw_sonar_image">,
): PointCloud | undefined {
  const msg = event.message;
  const beams = msg.image.beam_count;
  const samples = msg.samples_per_beam;
  if (beams === 0 || samples === 0) {
    return;
  }

  // Range bin size: dr = c / (2 * f_sample), matching the driver's ProjectedSonarImage ranges.
  const dr = msg.ping_info.sound_speed / (2 * msg.sample_rate);
  if (!isFinite(dr) || dr <= 0) {
    return;
  }

  const angles = msg.rx_angles;
  if (angles.length < beams) {
    return;
  }

  const src: any = msg.image.data;
  const stride = 16; // x, y, z, intensity as float32
  const cap = Math.min(
    MAX_POINTS,
    Math.ceil(beams / BEAM_STRIDE) * Math.ceil(samples / SAMPLE_STRIDE),
  );
  const buf = new Uint8Array(cap * stride);
  const view = new DataView(buf.buffer);

  let n = 0;
  for (let b = 0; b < beams && n < cap; b += BEAM_STRIDE) {
    const sinT = Math.sin(angles[b]);
    const cosT = Math.cos(angles[b]);
    for (let s = 0; s < samples && n < cap; s += SAMPLE_STRIDE) {
      const intensity = src[BEAM_MAJOR ? b * samples + s : s * beams + b];
      if (intensity === undefined || intensity < MIN_INTENSITY) {
        continue;
      }
      const r = (msg.sample0 + s) * dr;
      const o = n * stride;
      if (DRIVER_AXES) {
        view.setFloat32(o, 0, true);
        view.setFloat32(o + 4, r * sinT, true);
        view.setFloat32(o + 8, r * cosT, true);
      } else {
        view.setFloat32(o, r * cosT, true);
        view.setFloat32(o + 4, -r * sinT, true);
        view.setFloat32(o + 8, 0, true);
      }
      view.setFloat32(o + 12, intensity, true);
      n++;
    }
  }

  // ROS 2 sources expose the stamp as nanosec; keep nsec as a fallback.
  const st: any = msg.header.stamp;
  const cloud: PointCloud = {
    timestamp: { sec: st.sec, nsec: st.nsec !== undefined ? st.nsec : st.nanosec },
    frame_id: msg.header.frame_id,
    pose: {
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    point_stride: stride,
    fields: [
      { name: "x", offset: 0, type: NumericType.FLOAT32 },
      { name: "y", offset: 4, type: NumericType.FLOAT32 },
      { name: "z", offset: 8, type: NumericType.FLOAT32 },
      { name: "intensity", offset: 12, type: NumericType.FLOAT32 },
    ],
    data: buf.slice(0, n * stride),
  };
  return cloud;
}
