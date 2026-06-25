# @moxxy/plugin-plugins-admin

## 0.2.0

### Minor Changes

- 05df794: `/plugins` now distinguishes **built-in** (bundled) from **installed** (on-demand from `~/.moxxy/plugins`) packages instead of showing everything as "on": the plugin host reports `installed` (manifest present = discovered) and the Packages tab badges core / installed / built-in. The Installable catalog is also populated with the six unbundled API-key providers (anthropic, openai, google, xai, zai, local) so they can be installed from the picker (and the init optional-plugins step).

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0
  - @moxxy/config@0.21.0

## 0.1.0

### Minor Changes

- 2ccd62e: Unified `plugins:` manifest + critical floor (Pillar 1).

  Replace the three overlapping config stores (the flat `provider`/`mode`/`compactor`/`workflowExecutor` keys, the package-keyed `plugins:` map, and `~/.moxxy/preferences.json`) with a single category-grouped `plugins:` tree in `~/.moxxy/config.yaml`:

  - **`plugins.packages.<pkg>`** — the install/enable ledger (one entry per npm package).
  - **`plugins.<category>.{default, items}`** — the swap axis, one slot per registry kind, keyed by contribution name (e.g. `plugins.provider.default: anthropic`).

  A **critical floor** makes the platform unbreakable: core default modules can be _swapped_ to another registered implementation but never _disabled_ — a missing/typo'd default reverts to a protected built-in floor, kernel packages refuse to be disabled (`PLUGIN_PROTECTED`), and a boot assertion guarantees every non-nullable slot is filled.

  New swap surfaces: the `set_default`/`list_defaults` model tools, `moxxy plugins set-default`/`defaults`, the TUI `/plugins` **Defaults** tab, and a `PluginsAdminView.categories()`/`setCategoryDefault()` view contract.

  `preferences.json` is retired: the persisted provider/mode/model/disabled-set now live in the same tree, written through `@moxxy/config` (`setCategoryDefault`/`setProviderModel`/`setProviderEnabled`). **Breaking (pre-1.0, no back-compat):** existing `~/.moxxy/config.yaml` files using the old keys must be rewritten; `moxxy init`'s output and `config_init`'s template emit the new shape.

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0
  - @moxxy/config@0.2.0

## 0.0.30

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0
  - @moxxy/config@0.1.15

## 0.0.29

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0
  - @moxxy/config@0.1.14

## 0.0.28

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0
  - @moxxy/config@0.1.13

## 0.0.27

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1
  - @moxxy/config@0.1.12

## 0.0.26

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0
  - @moxxy/config@0.1.11

## 0.0.25

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2
  - @moxxy/config@0.1.10

## 0.0.24

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1
  - @moxxy/config@0.1.9

## 0.0.23

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0
  - @moxxy/config@0.1.8

## 0.0.22

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5
  - @moxxy/config@0.1.7

## 0.0.21

### Patch Changes

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4
  - @moxxy/config@0.1.6

## 0.0.20

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3
  - @moxxy/config@0.1.5

## 0.0.19

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2
  - @moxxy/config@0.1.4

## 0.0.18

### Patch Changes

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1
  - @moxxy/config@0.1.3

## 0.0.17

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0
  - @moxxy/config@0.1.2

## 0.0.16

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0
  - @moxxy/config@0.1.1

## 0.0.15

### Patch Changes

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0
  - @moxxy/config@0.1.0

## 0.0.14

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0
  - @moxxy/config@0.0.14

## 0.0.13

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0
  - @moxxy/config@0.0.13

## 0.0.12

### Patch Changes

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0
  - @moxxy/config@0.0.12

## 0.0.11

### Patch Changes

- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1
  - @moxxy/config@0.0.11

## 0.0.10

### Patch Changes

- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/sdk@0.8.0
  - @moxxy/config@0.0.10

## 0.0.9

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0
  - @moxxy/config@0.0.9

## 0.0.8

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0
  - @moxxy/config@0.0.8

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1
  - @moxxy/config@0.0.7

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0
  - @moxxy/config@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0
  - @moxxy/config@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3

## 0.0.1

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
