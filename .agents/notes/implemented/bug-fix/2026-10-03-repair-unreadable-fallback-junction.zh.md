# Agent Note: 修复 Node 读不回来的 profile 回退 junction

Status: implemented

[English](2026-10-03-repair-unreadable-fallback-junction.md) | 中文

## 问题

Windows 的 junction 把目标记在重解析数据里，当前 Node 只能读回 `\??\<路径>` 形式的替换名。桌面安装包携带的运行时（`runtime/node/bin/node.exe`，v22.22.0）写出的是 `\??\Global\<路径>`：对由它自己创建的 junction，`lstatSync().isSymbolicLink()` 为 false、`readlinkSync()` 抛 `EINVAL`、`lstatSync().isDirectory()` 为 true，而该 junction 在模块加载时仍能正常解析。在同一个目录里用同样的调用，Node v24.19.0 写出的是 `\??\<路径>` 形式，两个运行时都能把它读成符号链接。

于是 `healProfilesModuleFallback` 把上一次启动由自己写下的共享回退目录读成了真实目录，`ensureSymlink` 认定它不受管理并抛错：`dsh: ... exists and is not a symlink or dsh-managed module proxy; remove it so dsh can manage the installation fallback`。此后任何 Node 的启动都以同样方式失败，除非用户手工删除 `$DSH_HOME/profiles/node_modules`。共用同一个 home 的打包桌面运行时与源码 checkout 会这样互相下毒，打包运行时自己也无法第二次启动 profile。

## 决策

`ensureSymlink` 不再让启动失败，而是修复这种被读成目录的条目：先用 `rmdirSync` 删除，再重新写入链接。`rmdirSync` 只删除重解析点本身，绝不进入链接目标；对持有内容的真实目录它会失败，因此“装着包的真实目录”“普通文件”“指向另一代安装的链接”三者都保留原有的“大声失败”。`EEXIST` 竞态分支同样改为比较解析后的路径（`linkResolvesTo`）而非重解析数据：本进程读不出的链接，仍可能是并发启动写下的同一条链接。

## 考虑过的替代方案

**沿用删除受管 proxy 时所用的 `rmSync(link, { recursive: true })`。** 对本进程读成目录的条目，递归删除会穿过链接删掉链接所指向的安装（打包的 server 树），把“过期链接”变成“被毁掉的安装”。

**先探测该不可读链接、其余仍抛错。** Node 不暴露重解析标签，这个探测只能退化成区分大小写的解析路径比较。而 `rmdirSync` 对非空目录的拒绝本身就是更严格的判据，无需启发式；守卫的含义在不引入启发式的前提下得以保留。

**改用会写出可读 junction 的运行时，或让安装包停留在会写可读 junction 的 Node 线上。** 写出方是用户主机上该入口所携带的任意 Node，回退目录无论如何都必须同时兼容两种载体；只修写出方还会让所有已经写坏的 home 继续坏着。

## 后果

- 回退目录由“不可读 junction 运行时”写过的 Windows home，下次启动即可自愈，而不是拒绝启动。
- 若某主机的 Node 写出的正是不可读形式，它每次启动都会重写回退条目，因为 `moduleFallbackEntryCurrent` 无法确认自己读不出的链接；写出 `\??\<路径>` 的主机只需一次修复即可稳定。重写的规模以安装依赖闭包为界，且仍在既有的跨进程锁内进行。
- 验证方式：在桌面运行时写下的回退目录仍在的情况下，从 checkout 启动 `web` profile；以及在临时目录用打包运行时创建 junction，再用两个运行时分别查看它。
