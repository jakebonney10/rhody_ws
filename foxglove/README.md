# Gemini FLS Foxglove layout

`gemini_sonar_debug.json` — import in Foxglove via **Layouts → Import from file**.
Four tabs over the live `gemini_sonar_driver` topics, plus three embedded user
scripts (they ride along in the layout's `userNodes`; no separate install step).

## Tabs

| Tab | Shows |
| --- | --- |
| **Perception** | Sonar fan point cloud (3D), B-scan image, ping rate |
| **Health** | Gemini diagnostics summary + Streaming detail, head health flags, node log, TF tree |
| **Signal** | Range geometry, sound speed / frequency, beams / samples / payload, logger disk |
| **Raw & Control** | Derived stats, raw messages, start/stop service buttons, parameters |

## Scripts (`scripts/*.ts`, mirrored into the layout)

- `gemini_fan.ts` → `/foxglove_script/gemini_fan` (`foxglove.PointCloud`)
  Polar-to-Cartesian fan from `rx_angles` + range bins.
- `gemini_bscan.ts` → `/foxglove_script/gemini_bscan` (`foxglove.RawImage`, mono8)
  The `image.data` buffer shown as-is — one row per beam. No repacking, so it is cheap.
- `gemini_ping_stats.ts` → `/foxglove_script/gemini_ping_stats`
  Ping rate/interval and range geometry (`range_bin_m`, `range_min_m`, `range_max_m`)
  that the message carries only implicitly. Feeds the Plot panels.

Edit scripts in Foxglove under the **User Scripts** tab in the right sidebar (`]`).

## Tunables at the top of `gemini_fan.ts`

| Constant | Default | Why you'd change it |
| --- | --- | --- |
| `MIN_INTENSITY` | 25 | Raise to thin out water-column noise, lower to keep weak returns |
| `BEAM_STRIDE` / `SAMPLE_STRIDE` | 2 / 4 | 1024 beams x 2009 samples is 2.06M points per ping — decimation keeps the 3D panel responsive |
| `MAX_POINTS` | 120000 | Hard cap per ping |
| `BEAM_MAJOR` | `false` | Verified against live data — see below |
| `DRIVER_AXES` | `false` | REP-103 plan view — see below |

### Both settled against live data (2026-09-30)

1. **Buffer order — the driver's comment is wrong.** `glf_processor.cpp` describes
   `flat_data` as "row-major (beam-major)", but the buffer is actually **sample-major**:
   `index = sample * beam_count + beam`. Measured on a live ping (1024 beams x 2009
   samples), reshaping each way and comparing structure:

   | reshape | variation along range | variation across beams |
   | --- | --- | --- |
   | beam-major | std 0.58 (flat, no structure) | std 29.83 |
   | sample-major | std 29.84 (sharp returns) | std 2.73 (smooth) |

   Real sonar has sharp structure along range and smooth variation between adjacent
   beams, so sample-major is correct. The driver passes the Gemini SDK buffer through
   untouched and the SDK packs all beams per range sample; only the comment is wrong.
   Anything else consuming `RawSonarImage` from this driver needs the same correction.

2. **Axis convention.** `DRIVER_AXES = false` uses REP-103 (X forward, Y left, Z up),
   so the fan lies flat in the XY plane and reads as a conventional plan view under the
   panel's top-down orthographic camera (`perspective: false, phi: 0, thetaOffset: -90`),
   with the 1 m grid meaningful. Set it `true` for the driver's own
   `ProjectedSonarImage.beam_directions` convention (X up, Y right, Z forward), which
   puts the fan in the Y-Z plane; that then needs `phi: 90` and the grid turned off.

### Verified on a live ping

- Geometry: `rx_angles` span exactly ±60.000° over 1024 beams; `sample_rate` 150704 Hz,
  `sample0` 0, so `dr` = 4.98 mm and max range = 10.00 m, matching `range_m: 10.0`.
- Ping rate: steady ~4.99 Hz / ~200 ms in free-run at `image_quality_pixels: 2048`.
- Intensity distribution: median 5, p75 13, p90 53, p99 166. The 3D panel's colormap is
  scaled 20–140 rather than 0–255, or nearly everything renders dark blue.

## Two pre-existing issues this layout surfaces

- **`gemini_fls` is not in the TF tree.** `/tf_static` currently carries only
  `map→map_ned`, `odom→odom_ned` and `base_link→base_link_frd`, and
  `robot_state_publisher` is not running. Sonar data therefore renders in its own
  root frame and cannot be placed relative to `base_link`. The 3D panel is set to
  `followTf: gemini_fls` so it still renders standalone.
- **Frame-id mismatch.** The driver publishes `frame_id: "gemini_fls"`
  (`config/gemini.yaml`) but the URDF names the sensor link `fls_link`
  (`rhody/urdf/sensor_fov.xacro`). Those need to agree before TF will resolve.

## Note on topic names

Panels use the namespaced topics the node actually publishes —
`/rhody/perception/sensors/gemini/...` (the node runs with
`__ns:=/rhody/perception/sensors`). The bare `/gemini/...` names have zero
publishers.
