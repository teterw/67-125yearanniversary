#!/usr/bin/env bash
# Re-vendors the MediaPipe runtime into public/ so the app works offline.
# Run after bumping @mediapipe/tasks-vision, or on a fresh clone if
# public/mediapipe/ is not committed.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/node_modules/@mediapipe/tasks-vision/wasm"
wasm="$root/public/mediapipe/wasm"
models="$root/public/mediapipe/models"
model_url="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"

[ -d "$src" ] || { echo "Missing $src — run npm install first." >&2; exit 1; }

mkdir -p "$wasm" "$models"
for f in vision_wasm_internal.js vision_wasm_internal.wasm \
         vision_wasm_nosimd_internal.js vision_wasm_nosimd_internal.wasm; do
  cp "$src/$f" "$wasm/$f"
done
echo "Copied wasm runtime -> public/mediapipe/wasm"

curl -fsSL -o "$models/pose_landmarker_lite.task" "$model_url"
echo "Downloaded pose_landmarker_lite.task -> public/mediapipe/models"
