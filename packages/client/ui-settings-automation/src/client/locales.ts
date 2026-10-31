/** Automation settings section copy. Namespace `settings.automation`. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  nav: '自动化',
  scheduledTitle: '定时任务',
  scheduledBlurb: '程序按写死的步骤自动跑',
  deskTitle: '值班',
  deskBlurb: '智能化的自动化任务：无人值守，运行已有资产并留下报告',
  workTitle: 'Work 模式',
  workBlurb: '把一组资产跑起来，人在场',
  on: '开',
  off: '关',
  mixed: '部分开启',
  saving: '保存中…',
  loadFailed: '读取开关失败：{message}',
  saveFailed: '保存失败：{message}',
} satisfies Record<string, string>

/** Dictionary key union. */
export type AutomationSettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  nav: 'Automation',
  scheduledTitle: 'Scheduled tasks',
  scheduledBlurb: 'A program runs the declared steps',
  deskTitle: 'Value desk',
  deskBlurb: 'AI automation without a person present: runs existing assets and leaves reports',
  workTitle: 'Work mode',
  workBlurb: 'Run a set of assets, with a person present',
  on: 'On',
  off: 'Off',
  mixed: 'Partly on',
  saving: 'Saving…',
  loadFailed: 'Could not read the switches: {message}',
  saveFailed: 'Could not save: {message}',
} satisfies Record<AutomationSettingsKey, string>
