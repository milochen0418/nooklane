# Vendored MediaPipe face tracking

The browser tracks the face locally with MediaPipe Face Landmarker. These files
are served from this app, so a call needs no CDN or internet access.

| File | Source | License |
|------|--------|---------|
| `vision_bundle.js` | `@mediapipe/tasks-vision` 1.0.1 (npm), `vision_bundle.js` (IIFE, global `Vision`) | Apache-2.0 |
| `vision_wasm_internal.js`, `vision_wasm_internal.wasm` | same package, `wasm/` (SIMD build) | Apache-2.0 |
| `face_landmarker.task` | https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task | Apache-2.0 |

The npm tarball was verified against its registry integrity
`sha512-rvRE2FmAZ6ZxKSw7wq+e+jQDpN3t1B/tD2mJz9SmAzb1msoDkd4dMoE4wAh8Z30Um0PQwLiHr9QtomhmXk3aUQ==`.

SHA-256 of the vendored files:

```
98db72469ffb176f5e9f2687be0f70783893aca681f7789c34b872b0a764371a  vision_bundle.js
e170ee67dd4e16c1a6fcd8840a206687e5a59b22c20e4a902bc445b095454d73  vision_wasm_internal.js
8da277a733926eacd0474b8704b36742d6ec3231c57a860c5b889dff8f1df886  vision_wasm_internal.wasm
64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff  face_landmarker.task
```

Only the SIMD build is vendored: every browser with current WebRTC support also
supports WebAssembly SIMD. To update, take the same files from a newer
`@mediapipe/tasks-vision` release and bump `ASSETS_VERSION` in
`assets/face_tracker.js` (it busts the browser cache).
