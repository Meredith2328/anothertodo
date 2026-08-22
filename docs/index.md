---
layout: home
hero:
  name: anothertodo
  text: 轻量命令行 TODO 工具
  tagline: 一行模糊输入 · 全屏 TUI · 定时提醒 · git 多端同步
  image:
    src: /screenshots/tui/main-list.png
    alt: atd TUI 主界面
  actions:
    - theme: brand
      text: 快速上手
      link: /guide/quickstart
    - theme: alt
      text: TUI 指南
      link: /guide/tui
features:
  - icon: ⌨️
    title: 一行输入魔法
    details: "后天 买牛奶 很急 @18:30 —— 日期、紧急度、提醒自动解析，剩余词就是标题。支持中英文日期、紧急度短语与 12 小时制时间；`*每天` 重复和 `>>` 备注一行写完。"
  - icon: 🖥️
    title: 全屏 TUI
    details: "极简界面，分组清晰。j/k 移动、d 完成、e 编辑、: 命令、? 帮助，全键盘操作，鼠标也可用；子任务缩进显示，空格多选批量操作。"
  - icon: ⏰
    title: 定时提醒
    details: "后台守护进程每 30 秒扫描。Windows toast、邮件、自定义 hook，错过自动补发、失败退避重试。"
  - icon: 🔄
    title: git 多端同步
    details: "各端本地写、按需 sync 冲突合并。无服务端依赖，私有 git 仓库即可，代码开源、数据私有。"
  - icon: 🌱
    title: 重复任务与子任务
    details: "`*每天` 完成即自动滚动生成下一条，历史保留；`^父id` 子任务在列表和 TUI 里缩进显示，完成父任务时点名未完成子项。"
  - icon: 🌐
    title: 中英双语
    details: "界面语言自动跟随系统（`[ui] lang`），议程分组、日期列、字段名表都有英文版；一行输入和查询语法中英文完全一样。"
---
