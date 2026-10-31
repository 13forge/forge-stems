# forge-stems

A local-first DJ stem remix mixer in the browser.

Load stems onto four songs, ride the faders, and export a WAV of the mix. There are no accounts. Nothing is stored: audio stays in memory for the tab and is discarded when you leave.

## Run

```bash
npm ci
npm run dev
```

Open the local URL that Vite prints.

```bash
npm run typecheck
npm test
npm run build
npm run preview
```

## Vendored engine

The mixer engine is the WebAssembly package in `vendor/forge-audio-wasm-v3/` (the `.wasm` module, the JS glue, and the TypeScript declarations). Imports use the `@wasm` alias declared in `vite.config.ts` and `tsconfig.json`. The deck loads `vendor/forge-audio-wasm-v3/forge_audio_wasm_v3_bg.wasm` from that folder. Nothing in this tree copies a package out of another workspace.

## Provenance

- Front-end source commit: `687695a2`
- Audio engine commit: `ae41c5a8` (Moonforge sky `0e517012`, `read_telemetry_into` `1dede48b`, stem-split DSP `8300cd44`, `c4b5ba36`, and `ae41c5a8`)
- wasm-pack 0.13.1 (`--target web`, panic=abort, debug info off)
- wasm-bindgen 0.2.127
- wasm-opt 117 (`--dce --remove-unused-module-elements --strip-debug --strip-producers`)
- `vendor/forge-audio-wasm-v3/forge_audio_wasm_v3_bg.wasm`: 627,908 bytes
- sha256: `195ef28309f2133bea0532db97dd5c6d96b42b7ce3469abb3ee0100a3f9d45c0`

This build exports `stem_split_four` (mono PCM in, four packed mono stems out).

Release build of the vendored audio module. Symbols are stripped, and unused C exports that the JS glue does not call were removed (eight support-crate symbols plus the abort and instance-terminated handlers). The glue exposes `Engine.read_telemetry_into`, and `InitOutput` matches the exports that remain. Build-time path remapping, plus equal-length rewrites of any panic paths that survived it, keeps machine paths and toolchain locations out of the `.wasm`. The Moonforge sky shader is in this repo at `src/ui/shaders/launcher_sky.wgsl`. `src/ui/moonforge-sky.ts` mounts it behind `#app` when `navigator.gpu` can create a device, and stays inert otherwise. `vite.config.ts` keeps the `@wasm` alias on `vendor/forge-audio-wasm-v3` and does not allow the dev server to read a parent directory.
