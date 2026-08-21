# 多端同步（git）

模型：**每个端本地读写自己的 `tasks.jsonl`，`atd sync` 时才和远端合并**。不依赖任何服务端，私有 git 仓库（GitHub/Gitee/自建）皆可。

## 首次设置

```bash
cd ~/.atd
git remote add origin <你的私有仓库URL>
atd sync        # 首次：本地 commit 后 push，建立分支
```

<pre class="terminal-output">$ atd sync
远程为空：已推送并建立 master 分支</pre>

新设备接入：

```bash
git clone <仓库URL> ~/.atd
atd list        # 直接可用
```

## 日常同步

一端用一天，收工时 `atd sync`；另一端开工前 `atd sync`。TUI 里 `:sync` 等价。

<pre class="terminal-output">$ atd sync
同步完成（远端新变更已合并）</pre>

## 冲突规则

`tasks.jsonl` 一行一任务、行首是 id，所以合并按 id 进行：

| 场景 | 结果 |
|---|---|
| 两端各加了不同任务 | 并集，全保留 |
| 两端改了同一任务 | 取 `modified` 时间戳较新的一方 |
| 一端删除、另一端编辑 | **删除优先**（tombstone 语义） |
| 其他文件冲突（config 等） | 保留本地版本 |

已实测双端并发修改场景，合并后文件干净、历史线性（rebase），无需手动解决冲突。

## 同步状态

```bash
atd sync-status
```

<pre class="terminal-output">$ atd sync-status
无远程，待提交变更 1 项</pre>

## 数据安全

`undo.jsonl`、`archive.jsonl`、`.lock` 不进版本库（`.gitignore` 自动生成）。远端仓库设为私有即可；数据里只有你自己的任务文本。

> atd 源码是开源的，但**你的任务数据建议放在私有仓库**。代码开源、数据私有。

## 下一步

- [配置详解](/guide/config)
- [数据管理](/guide/storage)
- [API 参考](/api/README)
