---
description: "Automation settings section with one switch per configured loader-id group."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-automation

## Summary

`dsh-client-ui-settings-automation` is the Automation settings section. `Config.groups` names each switch and the Loader entry ids it turns together. Load fails when any id is missing from the current composition. The scheduled-tasks switch covers the `pipeline-scheduler` registration row and `ui-automation`; it does not unload the shared `automation-runner`, so the desk layer keeps its schedule. The desk switch covers `desk` and `ui-desk` and starts off through `defaultOn: false`. A mixed group reads as partly on; the switch then sets every id in the group to the same fact. A legacy user patch that still disables `automation-runner` is migrated to `pipeline-scheduler` at profile load, preserving the old switch's on/off intent.

## Model Experience

None. The package registers no model tool, prompt, or session event.

### KV Cache effect

None.

## Known Limitations and Deferred Work

- **切换开关会刷新页面。** A successful write reloads the whole page so the next boot graph omits a disabled client plugin. The reload is an inject callback; the section component does not touch `window`.
