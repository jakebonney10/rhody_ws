import { Input } from "./types.ts";

// The stock rosbag2 recorder reports nothing about itself except its /rosout
// lines and WriteSplitEvent, so this derives its state from those. State is
// only known from the first transition seen after Foxglove connected; until
// then it is UNKNOWN and the "Query is_paused" button is the way to check.
//
// rosbag2 0.26 (Jazzy) logs "Pausing recording." at INFO but a real resume
// only at DEBUG ("Already in the recording." - the two resume messages are
// swapped upstream). RECORDING is therefore only seen when the recorder runs
// with --log-level rhody.data.rosbag2_recorder:=debug; otherwise the state
// stays PAUSED after a Resume until the next pause.
const RECORDER_LOGGER = "rhody.data.rosbag2_recorder"; // logger of /rhody/data/rosbag2_recorder
const START_PAUSED = true; // record.start_paused in rhody/config/rosbag_record.yaml

export const inputs = ["/rosout", "/rhody/data/events/write_split"];
export const output = "/foxglove_script/rosbag_state";

type Output = {
  state: string; // RECORDING | PAUSED | STOPPED | UNKNOWN
  recording: boolean;
  state_known: boolean;
  bag_uri: string;
  topics_subscribed: number;
  splits: number;
  current_file: string;
  last_closed_file: string;
  last_event: string;
  last_event_time: string;
};

let state = "UNKNOWN";
let bagUri = "";
let topics = 0;
let splits = 0;
let currentFile = "";
let lastClosed = "";
let lastEvent = "";
let lastEventTime = "";

function iso(t: { sec: number; nsec: number }): string {
  return new Date(t.sec * 1000 + Math.floor(t.nsec / 1e6)).toISOString();
}

function note(what: string, t: { sec: number; nsec: number }): void {
  lastEvent = what;
  lastEventTime = iso(t);
}

export default function script(
  event: Input<"/rosout"> | Input<"/rhody/data/events/write_split">,
): Output {
  if (event.topic === "/rosout") {
    const m = event.message;
    if (m.name === RECORDER_LOGGER) {
      const msg = m.msg;
      if (msg.startsWith("Pausing recording")) {
        state = "PAUSED";
        note(msg, m.stamp);
      } else if (
        msg.startsWith("Resuming recording") ||
        msg.startsWith("Already in the recording")
      ) {
        state = "RECORDING";
        note("Resuming recording.", m.stamp);
      } else if (msg.startsWith("Recorder is already in pause state")) {
        state = "PAUSED";
        note(msg, m.stamp);
      } else if (msg.startsWith("Recording stopped")) {
        state = "STOPPED";
        note(msg, m.stamp);
      } else if (msg.startsWith("Starting recording to '")) {
        // A new recorder process: everything below is per run.
        bagUri = msg.slice("Starting recording to '".length, -1);
        state = START_PAUSED ? "PAUSED" : "RECORDING";
        topics = 0;
        splits = 0;
        currentFile = "";
        lastClosed = "";
        note(msg, m.stamp);
      } else if (msg.startsWith("Subscribed to topic")) {
        topics += 1;
      } else if (m.level >= 30) {
        note(msg, m.stamp); // WARN and above from the recorder itself
      }
    }
  } else {
    const m = event.message;
    splits += 1;
    currentFile = m.opened_file;
    lastClosed = m.closed_file;
    // WriteSplitEvent carries no stamp of its own.
    note("Bag split -> " + m.opened_file, event.receiveTime);
  }
  return {
    state,
    recording: state === "RECORDING",
    state_known: state !== "UNKNOWN",
    bag_uri: bagUri,
    topics_subscribed: topics,
    splits,
    current_file: currentFile,
    last_closed_file: lastClosed,
    last_event: lastEvent,
    last_event_time: lastEventTime,
  };
}
