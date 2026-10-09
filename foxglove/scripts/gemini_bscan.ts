import { Input } from "./types.ts";
import { RawImage } from "@foxglove/schemas";

// Verified against live data: the buffer is SAMPLE-major, index = sample * beam_count + beam,
// so one row per range sample -- width is bearing, height is range.
const BEAM_MAJOR = false;

export const inputs = ["/rhody/perception/sensors/gemini/raw_sonar_image"];
export const output = "/foxglove_script/gemini_bscan";

export default function script(
  event: Input<"/rhody/perception/sensors/gemini/raw_sonar_image">,
): RawImage | undefined {
  const msg = event.message;
  const beams = msg.image.beam_count;
  const samples = msg.samples_per_beam;
  if (beams === 0 || samples === 0) {
    return;
  }

  const width = BEAM_MAJOR ? samples : beams;
  const height = BEAM_MAJOR ? beams : samples;

  const src: any = msg.image.data;
  const bytes: Uint8Array = src instanceof Uint8Array ? src : new Uint8Array(src);
  const need = width * height;
  if (bytes.length < need) {
    return;
  }

  // ROS 2 sources expose the stamp as nanosec; keep nsec as a fallback.
  const st: any = msg.header.stamp;
  const image: RawImage = {
    timestamp: { sec: st.sec, nsec: st.nsec !== undefined ? st.nsec : st.nanosec },
    frame_id: msg.header.frame_id,
    width: width,
    height: height,
    encoding: "mono8",
    step: width,
    data: bytes.length === need ? bytes : bytes.slice(0, need),
  };
  return image;
}
