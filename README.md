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
- wasm-pack 0.13.1
- wasm-bindgen 0.2.127
- wasm-opt 117
- `vendor/forge-audio-wasm-v3/forge_audio_wasm_v3_bg.wasm`: 624752 bytes
- sha256: `54b3ce03a4d3726a2b8f06de84a177519bce9fc97452a649d596f6de937e2778`

Build-time path remapping was applied so panic locations in the `.wasm` do not carry absolute machine paths.
