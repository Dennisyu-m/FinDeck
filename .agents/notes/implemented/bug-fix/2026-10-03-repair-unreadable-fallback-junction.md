# Agent Note: Repair a profile fallback junction Node cannot read back

Status: implemented

English | [中文](2026-10-03-repair-unreadable-fallback-junction.zh.md)

## Problem

A Windows junction carries its target in reparse data whose substitute name the
Node in use reads back only in the `\??\<path>` form. The runtime the desktop
installer ships (`runtime/node/bin/node.exe`, v22.22.0) writes
`\??\Global\<path>` instead: for a junction that runtime created itself,
`lstatSync().isSymbolicLink()` is false, `readlinkSync()` fails with `EINVAL`,
and `lstatSync().isDirectory()` is true, while the junction still resolves for
module loading. Node v24.19.0 invoked with the same call in the same directory
writes the `\??\<path>` form, which both runtimes read as a symlink.

`healProfilesModuleFallback` therefore read the shared fallback it had written
on the previous launch as a directory, `ensureSymlink` refused it as unmanaged,
and the launch died with `dsh: ... exists and is not a symlink or dsh-managed
module proxy; remove it so dsh can manage the installation fallback`. Every
later launch from any Node failed the same way until the user deleted
`$DSH_HOME/profiles/node_modules` by hand. A packaged desktop runtime and a
checkout sharing one home poison each other this way, and the packaged runtime
cannot boot its own profile twice.

## Decision

`ensureSymlink` repairs an entry that reads as a directory instead of failing
the launch, by removing it with `rmdirSync` before writing the link again.
`rmdirSync` removes the reparse point alone: it never descends into the link
target, and it fails on a real directory that holds anything, so a package
directory, a regular file, and a link pointing at another installation
generation all keep the fail-loud error. The `EEXIST` race branch compares
resolved paths (`linkResolvesTo`) rather than reparse data, for the same reason:
a link this process cannot read can still be the identical link a concurrent
launch wrote.

## Alternatives considered

**`rmSync(link, { recursive: true })`, the removal already used for a managed
proxy.** On an entry Node reads as a directory, recursive removal walks through
the link and deletes the installation the link targets — the packaged server
tree — turning a stale link into a destroyed installation.

**Probe for the unreadable link before removing it, then keep the error for
everything else.** Node exposes no reparse tag, so the probe would be a
casing-sensitive resolved-path comparison standing in for one. Failing
`rmdirSync` on a non-empty directory is the stricter test and needs no
heuristic; the guard keeps its meaning without one.

**Ship a runtime that writes readable junctions, or hold the installer on a
Node line that does.** The writer runs on the user's host under whichever Node
that surface ships, so the fallback has to survive both carriers regardless;
fixing the writer would leave the same home broken for every already-written
entry.

## Consequences

- A Windows home whose fallback was written by an unreadable-junction runtime
  heals on its next launch instead of refusing to boot.
- A host whose Node writes the unreadable form rewrites the fallback entries on
  every launch, because `moduleFallbackEntryCurrent` cannot confirm a link it
  cannot read; a host that writes `\??\<path>` settles after one repair. The
  rewrite is bounded by the installation dependency closure and happens under
  the existing cross-process lock.
- Exercised by booting the `web` profile from the checkout with the
  desktop-written fallback in place, and by creating a junction with the
  packaged runtime in a scratch directory and inspecting it with both runtimes.
