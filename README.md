# AI 灵境（AI Dreamscape）

AI 灵境是一组部署在 GitHub Pages 上的纯前端 AI 工具。目前由少量测试用户共同验证，仓库以稳定运行和可回退维护为优先目标。

## 在线地址

https://z1641818653-blip.github.io/AI-Dreamscape/index.html

## 页面状态

| 页面 | 用途 | 当前状态 |
| --- | --- | --- |
| `index.html` | 工具入口 | 已上线 |
| `chat.html` | 多模型聊天工作台 | 线上 v4.0.2；新版维护中 |
| `chatroom.html` | 多 AI 聊天室 | 测试中 |
| `mdtest.html` | Markdown 与公式测试 | 可用 |
| `latex.html` | LaTeX 编辑与编译 | 兼容性测试中 |
| `workflow.html` | AI 流程树 | 暂未上线，修复中 |

## 分支约定

- `main`：线上稳定版本，GitHub Pages 只从这里发布。
- `dev`：下一版集成与测试，不保证始终稳定。
- `fix/<名称>`：单项故障修复，例如 `fix/workflow-storage`。
- `feature/<名称>`：新功能实验，例如 `feature/chat-ui`。

正式文件名保持固定，不使用“最终版”“坏了”“修复2”等文件名保存历史。历史版本由 Git 提交和标签负责保存。

## 建议发布流程

1. 从 `main` 创建修复或功能分支。
2. 每次提交只处理一类问题，并写清楚提交说明。
3. 合并到 `dev` 后完成连续发送、刷新恢复、公式、代码块和导航测试。
4. 通过 Pull Request 检查即将进入 `main` 的差异。
5. 合并到 `main` 后创建稳定版本标签，并更新 `CHANGELOG.md`。

推荐的提交格式：

```text
fix(chat): 修复连续发送重复提问
fix(chatroom): 修复流式响应解析
style(chat): 优化按钮和代码块外观
docs(index): 更新工具状态说明
```

## 数据与 API Key

对话记录和 API Key 主要保存在当前浏览器中。纯前端不等于绝对安全：不要在公共设备保存密钥，不要把 API Key 写入 HTML、提交记录、截图或导出文件，并建议定期更换密钥。

## 恢复原则

发现线上故障时，优先回退到最近的稳定提交；不要通过重命名正式文件保存坏版本。故障应在独立分支修复并验证后重新发布。

