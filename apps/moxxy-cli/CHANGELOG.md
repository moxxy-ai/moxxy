# Changelog

## [1.1.0](https://github.com/moxxy-ai/moxxy/compare/moxxy-cli-v1.0.0...moxxy-cli-v1.1.0) (2026-04-07)


### Features

* add ASCII logo to CLI help and interactive menu ([3b8caf4](https://github.com/moxxy-ai/moxxy/commit/3b8caf4a1d5ebe90f6d0375d3c83b7d5b6953088))
* add doctor and uninstall commands ([684cbbe](https://github.com/moxxy-ai/moxxy/commit/684cbbe7f631ed7451030918ba2f6d327cbc82aa))
* add full-screen TUI with Ink (React for terminal) ([e31a6d1](https://github.com/moxxy-ai/moxxy/commit/e31a6d10420878743c6d7be697c5cd8db86baf66))
* add interactive wizard flows to CLI with @clack/prompts ([27b01d2](https://github.com/moxxy-ai/moxxy/commit/27b01d23dc1e4e9f468113fac15f96c8ab1cc4ab))
* add new picker to all comands ([1424bf1](https://github.com/moxxy-ai/moxxy/commit/1424bf1cdf44c901c1396d1e820d21ac4053c457))
* add openai codex oAuth implementation ([39ec0d7](https://github.com/moxxy-ai/moxxy/commit/39ec0d71d7fc6e24eca1cc9d970cc9986256f130))
* add openai codex oAuth implementation ([3975185](https://github.com/moxxy-ai/moxxy/commit/3975185c43ae630c7e723b81023c5d32be7dc358))
* add picker to others commands with stepper and scroll behaviour ([110f335](https://github.com/moxxy-ai/moxxy/commit/110f335056c10e4d439a9faaf494f6523c000cde))
* add plugins support ([ac06c38](https://github.com/moxxy-ai/moxxy/commit/ac06c3824986912dac3662c155496c52f5946407))
* create token usage and context ([d6369a7](https://github.com/moxxy-ai/moxxy/commit/d6369a70e6d248a893aa7346ff411bd4301d57e9))
* fix problem with headless login ([4402d42](https://github.com/moxxy-ai/moxxy/commit/4402d42ae1e9ab1597954359cd7842f3466f6723))
* implement remaining endpoints — skill list, heartbeat disable, vault list/revoke ([248beb3](https://github.com/moxxy-ai/moxxy/commit/248beb3a58bcf0217e91d2939e1287a03b49d36f))
* MCP support, agent kinds, TUI rewrite, templates, webhooks overhaul ([3f33219](https://github.com/moxxy-ai/moxxy/commit/3f332193551c11f5dc801540e3702d21ed3dd9b0))
* ollama provider implementation without ui picker ([c77cc3d](https://github.com/moxxy-ai/moxxy/commit/c77cc3d03339eb624c368c5c36eb9a6ebda429ae))
* provider install with built-in catalog, API keys, and custom models ([a629dff](https://github.com/moxxy-ai/moxxy/commit/a629dffdd963dd51b161565809458fac109cf83a))
* runtime execution engine, agent run lifecycle, TUI enhancements ([8de1a96](https://github.com/moxxy-ai/moxxy/commit/8de1a96136edb1b937c8bab8ec5a41a5893d620e))
* show ASCII logo in init wizard ([3adca12](https://github.com/moxxy-ai/moxxy/commit/3adca12f4e079c6c2fa232e201281722076da5fe))
* upgarde tui picker ([9629091](https://github.com/moxxy-ai/moxxy/commit/9629091133bdc28f90eada43a8407a6b410a4001))
* use ~/.moxxy as home directory + update model catalog to 2026 ([fd6c1bd](https://github.com/moxxy-ai/moxxy/commit/fd6c1bd05f7f44fc42605e7a112544d612111759))
* Wave 4 - Node.js CLI restructured to spec with consolidated test suite ([98560c2](https://github.com/moxxy-ai/moxxy/commit/98560c255d3363f70967bae6998d0c9801649b54))
* Wave 4 - Node.js CLI with API client, auth/agent commands, SSE consumer ([37e7ac1](https://github.com/moxxy-ai/moxxy/commit/37e7ac193855891708f5cd667ad84a94c268ad9d))
* Waves 2+3F — WASI plugins, memory compaction, TUI enhancements ([cd9b283](https://github.com/moxxy-ai/moxxy/commit/cd9b283d0667feaa2dcd95ee351414c01f8aa05c))


### Bug Fixes

* browser primitive + allowlist ([f3a6813](https://github.com/moxxy-ai/moxxy/commit/f3a68130daa31f8442a3f3af585e291fed40600f))
* changed registry ([1318778](https://github.com/moxxy-ai/moxxy/commit/1318778f715e75d1204d1bc2601d6ddb1f1535d0))
* dangling cli file ([445ce78](https://github.com/moxxy-ai/moxxy/commit/445ce7849e4bfb0ab4b1a39c1132663ddb91c5e3))
* dead-code leaf in macos ([14ff7fe](https://github.com/moxxy-ai/moxxy/commit/14ff7fe151c6fd246681c0c848145ab612ed38d8))
* errors and confilts fixes ([62439e7](https://github.com/moxxy-ai/moxxy/commit/62439e7e80f2dcf67bd417cb25d2bf1aec83821f))
* gateway chat ([6fcedba](https://github.com/moxxy-ai/moxxy/commit/6fcedba42149a0eb64bd19a3f06a9d4455575638))
* infinite loop ([23caae6](https://github.com/moxxy-ai/moxxy/commit/23caae6efe9e41de5b9fc82472437111d8c59ced))
* menu grouping ([297e5d3](https://github.com/moxxy-ai/moxxy/commit/297e5d380266102b495f8dce8684dd3e0e508700))
* missing env vars for vite based plugins ([480451e](https://github.com/moxxy-ai/moxxy/commit/480451e7cb581f76f0299482fd0a3acbe4f01e6d))
* oauth unstyled page ([ff44b2b](https://github.com/moxxy-ai/moxxy/commit/ff44b2b166307513cfd21fd51241e5ffe6f5b1c7))
* ports ([fff6d7f](https://github.com/moxxy-ai/moxxy/commit/fff6d7f31bead912f1ae8ffde84568e064dccfaa))
* remove stale db files and add *.db to gitignore ([d9da22e](https://github.com/moxxy-ai/moxxy/commit/d9da22e09f60c108c4d2ced510f6ed91854c3e2f))
* remove stale scripts ([36ea345](https://github.com/moxxy-ai/moxxy/commit/36ea3454b9742f799ce9ebb79a97c0531f3740d4))
* same method login like first start method ([3659891](https://github.com/moxxy-ai/moxxy/commit/36598915744eba4f97dde98eb1ab29be3f54ec8e))
* telegram messages ([514036f](https://github.com/moxxy-ai/moxxy/commit/514036fc4c4bec81c347837fb5ffbe8fc2d93dfe))
* tests ([1b6f69c](https://github.com/moxxy-ai/moxxy/commit/1b6f69c25e18f343c720f908a3c8b69f27a6ebc5))
* use raw fetch for gateway health check in init wizard ([57f0942](https://github.com/moxxy-ai/moxxy/commit/57f094235e8ac3d6b3bd23542fcad7f29cb754d2))
* Wave 5 - cargo fmt, clippy fixes, CLI export alignment ([8c0273f](https://github.com/moxxy-ai/moxxy/commit/8c0273f83cd31ca8305e212132b9b92cc0503306))
