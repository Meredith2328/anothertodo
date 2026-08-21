import { defineConfig } from "vitepress";

// base 必须是 /<repo>/（GitHub Pages 项目站）。本地 preview 也用同一 base，
// 避免本地/线上资源路径不一致（这是静态资源加载最常见的问题）。
export default defineConfig({
  lang: "zh-CN",
  title: "anothertodo (atd)",
  description: "轻量命令行 TODO 工具：模糊输入、TUI、提醒、git 同步",
  base: "/anothertodo/",
  // 仓库遗留的旧文档与开发记录不进站点，避免与新版 guide/ 重复混乱
  srcExclude: ["guide.md", "node-usage.md", "platform-acceptance.md", "ts-migration-plan.md", "input-enhancements.md"],
  head: [
    ["meta", { name: "theme-color", content: "#56d4dd" }],
    ["link", { rel: "icon", href: "/anothertodo/icon.svg", type: "image/svg+xml" }],
  ],

  themeConfig: {
    logo: "/icon.svg",
    siteTitle: "anothertodo",
    nav: [
      { text: "指南", link: "/guide/intro" },
      { text: "TUI", link: "/guide/tui" },
      { text: "API", link: "/api/README" },
      { text: "实测证据", link: "/guide/verification" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "快速上手",
          items: [
            { text: "介绍", link: "/guide/intro" },
            { text: "安装", link: "/guide/install" },
            { text: "三分钟上手", link: "/guide/quickstart" },
          ],
        },
        {
          text: "核心功能",
          items: [
            { text: "一行输入魔法", link: "/guide/input" },
            { text: "命令行 (CLI)", link: "/guide/cli" },
            { text: "全屏界面 (TUI)", link: "/guide/tui" },
            { text: "查询语法", link: "/guide/query" },
            { text: "提醒系统", link: "/guide/reminders" },
            { text: "优先级双模式", link: "/guide/priority" },
            { text: "多端同步", link: "/guide/sync" },
            { text: "配置详解", link: "/guide/config" },
            { text: "数据管理", link: "/guide/storage" },
          ],
        },
        {
          text: "实测与开发",
          items: [
            { text: "实测证据", link: "/guide/verification" },
            { text: "API 参考", link: "/api/README" },
            { text: "开发与构建", link: "/guide/development" },
          ],
        },
      ],
    },
    footer: {
      message: "anothertodo — 轻量命令行 TODO 工具",
      copyright: `基于 tag node-v0.2.0 之后快照（commit c236fc8）`,
    },
    search: { provider: "local" },
    socialLinks: [
      { icon: "github", link: "https://github.com/Meredith2328/anothertodo" },
    ],
    docFooter: { prev: "上一页", next: "下一页" },
    outline: { label: "本页目录", level: [2, 3] },
    lastUpdated: { text: "最后更新" },
    returnToTopLabel: "回到顶部",
    sidebarMenuLabel: "菜单",
    darkModeSwitchLabel: "外观",
    lightModeSwitchTitle: "切换到浅色模式",
    darkModeSwitchTitle: "切换到深色模式",
  },

  markdown: {
    lineNumbers: true,
  },
});
