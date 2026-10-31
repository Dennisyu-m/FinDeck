/** Scheduled-tasks page copy. Namespace `ui.automation`. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'automation.nav': '定时任务',
  'automation.title': '定时任务',
  'automation.subtitle': '按流水线声明的时间自动运行。会话关掉也会跑，只要这个服务开着。',
  'automation.refresh': '刷新列表',
  'automation.runNow': '立即运行',
  'automation.running': '运行中…',
  'automation.listLoading': '正在读取定时任务…',
  'automation.listError': '读取失败：{message}',
  'automation.listEmpty': '没有定时任务。',
  'automation.runError': '运行失败：{message}',
  'automation.triggerManual': '手动',
  'automation.triggerCron': 'cron {schedule}',
  'automation.triggerInterval': '每 {seconds} 秒',
  'automation.triggerUnknown': '{kind}',
  'automation.nextNone': '不自动触发',
  'automation.next': '下次 {time}',
  'automation.lastNone': '还没有运行记录',
  'automation.last': '上次 {time} · {status}',
  'automation.exit': '退出码 {code}',
  'automation.timedOut': '已超时',
  'automation.notTimedOut': '未超时',
  'automation.status.ok': '成功',
  'automation.status.failed': '失败',
  'automation.status.skipped': '跳过',
} satisfies Record<string, string>

/** Dictionary key union. */
export type AutomationLocaleKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'automation.nav': 'Scheduled tasks',
  'automation.title': 'Scheduled tasks',
  'automation.subtitle': 'Runs on the time declared in each pipeline. A closed session still runs, as long as this service is up.',
  'automation.refresh': 'Refresh list',
  'automation.runNow': 'Run now',
  'automation.running': 'Running…',
  'automation.listLoading': 'Reading scheduled tasks…',
  'automation.listError': 'Read failed: {message}',
  'automation.listEmpty': 'No scheduled tasks.',
  'automation.runError': 'Run failed: {message}',
  'automation.triggerManual': 'Manual',
  'automation.triggerCron': 'cron {schedule}',
  'automation.triggerInterval': 'Every {seconds}s',
  'automation.triggerUnknown': '{kind}',
  'automation.nextNone': 'Not armed',
  'automation.next': 'Next {time}',
  'automation.lastNone': 'No run recorded',
  'automation.last': 'Last {time} · {status}',
  'automation.exit': 'exit {code}',
  'automation.timedOut': 'Timed out',
  'automation.notTimedOut': 'Not timed out',
  'automation.status.ok': 'ok',
  'automation.status.failed': 'failed',
  'automation.status.skipped': 'skipped',
} satisfies Record<AutomationLocaleKey, string>
